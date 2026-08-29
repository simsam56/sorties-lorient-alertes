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
