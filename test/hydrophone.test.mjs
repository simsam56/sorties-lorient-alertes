import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHydrophoneSessionsRequest,
  parseHydrophoneSessions,
} from "../src/adapters/hydrophone.mjs";

const source = {
  id: "hydrophone",
  name: "Hydrophone",
  url: "https://billetterie.hydrophone.fr/",
  homeUrl: "https://www.hydrophone.fr/",
  adapter: "hydrophone",
  city: "Lorient",
  venue: "Hydrophone",
};

const token = "jeton-public-de-test-123456789";

function session(overrides = {}) {
  return {
    id: 606,
    entity_type: "event",
    edito: { title: "CQ WRESTLING" },
    start_date: 4098367800,
    location: { title: "HYDROPHONE", city: "LORIENT" },
    public_link: "https://billetterie.hydrophone.fr/agenda/606-CQ-WRESTLING?session=606",
    infos_status: {
      publication: "on_sale",
      available: true,
      closed: false,
      additionnals: [{ key: "", libelle: "", lang: "*", display_setting: null }],
    },
    settings: { pass: { is_pass: false } },
    ...overrides,
  };
}

test("construit la requête API depuis le jeton public de la billetterie officielle", () => {
  const html = `<sonic-tickets-app serviceURL="/api/v2" token="${token}"></sonic-tickets-app>`;

  assert.deepEqual(buildHydrophoneSessionsRequest(html, source), {
    url: "https://billetterie.hydrophone.fr/api/v2/sessions?next=1&limit=100&offset=0&features%5B%5D=location&features%5B%5D=status&features%5B%5D=settings",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
});

test("refuse une page sans signature API Hydrophone exacte", () => {
  assert.throws(
    () => buildHydrophoneSessionsRequest("<main>Billetterie</main>", source),
    /Hydrophone: signature API officielle absente/,
  );
  assert.throws(
    () => buildHydrophoneSessionsRequest(`<sonic-tickets-app serviceURL="https://evil.example/api" token="${token}"></sonic-tickets-app>`, source),
    /Hydrophone: signature API officielle absente/,
  );
});

test("extrait seulement une vente Hydrophone disponible, future et non annulée", () => {
  const payload = JSON.stringify({
    success: true,
    total: 6,
    data: [
      session(),
      session({ id: 578, public_link: "https://billetterie.hydrophone.fr/agenda/578-CIEL?session=578", edito: { title: "CIEL" }, infos_status: { publication: "on_sale", available: false, closed: false, additionnals: [{ key: "canceled", libelle: "Annulé", lang: "*", display_setting: true }] } }),
      session({ id: 607, public_link: "https://billetterie.hydrophone.fr/agenda/607-PASS?session=607", edito: { title: "PASS SAISON" }, settings: { pass: { is_pass: true } } }),
      session({ id: 608, public_link: "https://billetterie.hydrophone.fr/agenda/608-LES-ARCS?session=608", edito: { title: "Concert aux Arcs" }, location: { title: "LES ARCS", city: "QUEVEN" } }),
      session({ id: 609, public_link: "https://billetterie.hydrophone.fr/agenda/609-FERME?session=609", edito: { title: "Vente fermée" }, infos_status: { publication: "on_sale", available: true, closed: true, additionnals: [] } }),
      session({ id: 610, public_link: "https://billetterie.hydrophone.fr/agenda/610-HORS-VENTE?session=610", edito: { title: "Pas encore en vente" }, infos_status: { publication: "draft", available: true, closed: false, additionnals: [] } }),
    ],
  });

  assert.deepEqual(parseHydrophoneSessions(payload, source, new Date("2099-01-01T00:00:00Z")), [{
    title: "CQ WRESTLING",
    startsOn: "2099-11-14",
    startsAt: null,
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://billetterie.hydrophone.fr/agenda/606-CQ-WRESTLING?session=606",
    sourceUrl: "https://www.hydrophone.fr/",
    sourceId: "hydrophone",
  }]);
});

test("refuse une vente Hydrophone qui sort du chemin officiel ou change de session", () => {
  for (const publicLink of [
    "https://evil.example/agenda/606-CQ-WRESTLING?session=606",
    "https://billetterie.hydrophone.fr/agenda/606-CQ-WRESTLING?session=999",
    "https://billetterie.hydrophone.fr/account?session=606",
  ]) {
    assert.throws(
      () => parseHydrophoneSessions(JSON.stringify({ success: true, total: 1, data: [session({ public_link: publicLink })] }), source, new Date("2099-01-01T00:00:00Z")),
      /Hydrophone: session API invalide/,
    );
  }
});

test("refuse une dérive de schéma sur une session événement au lieu de conclure à zéro vente", () => {
  const malformed = session();
  delete malformed.infos_status;

  assert.throws(
    () => parseHydrophoneSessions(
      JSON.stringify({ success: true, total: 1, data: [malformed] }),
      source,
      new Date("2099-01-01T00:00:00Z"),
    ),
    /Hydrophone: session API invalide/,
  );
});

test("refuse une page API incomplète lorsque le total annonce d'autres sessions", () => {
  assert.throws(
    () => parseHydrophoneSessions(
      JSON.stringify({ success: true, total: 101, data: [] }),
      source,
      new Date("2099-01-01T00:00:00Z"),
    ),
    /Hydrophone: réponse API invalide/,
  );
});
