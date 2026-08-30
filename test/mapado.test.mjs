import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMapado } from "../src/adapters/mapado.mjs";

const source = {
  id: "mapado-strapontin",
  name: "Le Strapontin",
  url: "https://lestrapontin.mapado.com/",
  city: "Pont-Scorff",
  venue: "Le Strapontin",
};

function mapadoHtml(items) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { entities: { ticketings: { "hydra:member": items } } } },
  })}</script>`;
}

function datedSale(overrides = {}) {
  return {
    title: "Vente témoin",
    type: "dated_events",
    isOnSale: true,
    availabilityStatus: "onSale",
    slug: "vente-temoin",
    sellingDeviceSchedule: {
      "/v1/selling_devices/3326": { fr: "Sam. 26 sept. 2026 à 20:00" },
    },
    ...overrides,
  };
}

test("extrait seulement la vente datée disponible de la signature Mapado", async () => {
  const html = await readFile(new URL("./fixtures/mapado.html", import.meta.url), "utf8");

  assert.deepEqual(parseMapado(html, source), [{
    title: "NE PAS PLEURER DEVANT UN COUCHER DE SOLEIL",
    startsOn: "2026-09-26",
    startsAt: null,
    venue: "Théâtre Le Strapontin",
    city: "Pont-Scorff",
    bookingUrl: "https://lestrapontin.mapado.com/event/783527-ne-pas-pleurer-devant-un-coucher-de-soleil",
    sourceUrl: "https://lestrapontin.mapado.com/",
    sourceId: "mapado-strapontin",
  }]);
});

test("ignore les offres et produits ainsi que les ventes indisponibles", async () => {
  const html = await readFile(new URL("./fixtures/mapado.html", import.meta.url), "utf8");

  assert.equal(parseMapado(html, source).length, 1);
});

test("refuse une page de connexion étrangère à Mapado", () => {
  assert.throws(
    () => parseMapado("<html><body><form><input type=\"password\"></form></body></html>", source),
    /Le Strapontin: signature Mapado absente/,
  );
});

test("refuse une signature Mapado dont le JSON est corrompu", () => {
  assert.throws(
    () => parseMapado('<script id="__NEXT_DATA__" type="application/json">{invalide}</script>', source),
    SyntaxError,
  );
});

test("refuse une signature Mapado sans collection de billetterie", () => {
  assert.throws(
    () => parseMapado('<script id="__NEXT_DATA__" type="application/json">{}</script>', source),
    /Le Strapontin: collection Mapado absente/,
  );
});

test("refuse une entrée nulle dans la collection Mapado", () => {
  assert.throws(
    () => parseMapado(mapadoHtml([null]), source),
    /Le Strapontin: structure Mapado invalide/,
  );
});

test("refuse une entrée de planning Mapado nulle", () => {
  assert.throws(
    () => parseMapado(mapadoHtml([{
      title: "Vente endommagée",
      type: "dated_events",
      isOnSale: true,
      availabilityStatus: "onSale",
      slug: "vente-endommagee",
      sellingDeviceSchedule: { "/v1/selling_devices/3326": null },
    }]), source),
    /Le Strapontin: structure Mapado invalide/,
  );
});

test("refuse avec le contexte source chaque champ structurant absent d'une vente datée", () => {
  for (const field of ["availabilityStatus", "isOnSale", "title", "slug"]) {
    const item = datedSale();
    delete item[field];
    assert.throws(
      () => parseMapado(mapadoHtml([item]), source),
      new RegExp(`Le Strapontin:.*${field}`, "u"),
      field,
    );
  }
});

test("refuse avec le contexte source les mauvais types d'une vente datée", () => {
  for (const [field, value] of [
    ["availabilityStatus", true],
    ["isOnSale", "true"],
    ["title", 42],
    ["slug", {}],
  ]) {
    assert.throws(
      () => parseMapado(mapadoHtml([datedSale({ [field]: value })]), source),
      new RegExp(`Le Strapontin:.*${field}`, "u"),
      field,
    );
  }
});

test("refuse un slug vide ou ambigu au lieu de fabriquer une URL undefined", () => {
  for (const slug of [
    "",
    "../autre-page",
    "%2e%2e",
    "..\\autre-page",
    "vente%2Fautre-page",
    "vente%5Cautre-page",
    "vente?redirection=ailleurs",
    "vente#fragment",
    "Vente-Temoin",
    "vente-témoin",
    "vente--temoin",
  ]) {
    assert.throws(
      () => parseMapado(mapadoHtml([datedSale({ slug })]), source),
      /Le Strapontin:.*slug/u,
      slug,
    );
  }
});

test("construit l'URL finale Mapado sur l'origine et le chemin exacts", () => {
  const [event] = parseMapado(mapadoHtml([datedSale({
    slug: "735130-ouverture-de-saison-26-27",
  })]), {
    ...source,
    url: "https://lestrapontin.mapado.com/catalogue/?lang=fr#ventes",
  });
  const bookingUrl = new URL(event.bookingUrl);

  assert.equal(bookingUrl.origin, "https://lestrapontin.mapado.com");
  assert.equal(bookingUrl.pathname, "/event/735130-ouverture-de-saison-26-27");
  assert.equal(bookingUrl.search, "");
  assert.equal(bookingUrl.hash, "");
  assert.equal(
    event.bookingUrl,
    "https://lestrapontin.mapado.com/event/735130-ouverture-de-saison-26-27",
  );
});

test("refuse une vente candidate sans planning structuré ni date exploitable", () => {
  for (const sellingDeviceSchedule of [
    undefined,
    null,
    [],
    {},
    { "/v1/selling_devices/3326": { fr: 42 } },
    { "/v1/selling_devices/3326": { fr: "date à venir" } },
  ]) {
    assert.throws(
      () => parseMapado(mapadoHtml([datedSale({ sellingDeviceSchedule })]), source),
      /Le Strapontin:.*sellingDeviceSchedule/u,
    );
  }
});

test("contextualise une date Mapado syntaxiquement française mais impossible", () => {
  assert.throws(
    () => parseMapado(mapadoHtml([datedSale({
      sellingDeviceSchedule: {
        "/v1/selling_devices/3326": { fr: "Sam. 31 févr. 2026 à 20:00" },
      },
    })]), source),
    /Le Strapontin:.*sellingDeviceSchedule\.date/u,
  );
});

test("ignore un produit non daté même s'il ne porte aucun champ de vente", () => {
  assert.deepEqual(parseMapado(mapadoHtml([{ type: "offer" }]), source), []);
});
