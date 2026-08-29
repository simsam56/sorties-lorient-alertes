import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTourismCandidates } from "../src/adapters/tourism.mjs";
import { parseLorientEventsCandidates } from "../src/adapters/lorient-events.mjs";
import { findReservationUrl, resolveReservation } from "../src/adapters/reservation-links.mjs";

const tourism = {
  id: "tourism",
  name: "Lorient Bretagne Sud Tourisme",
  url: "https://www.lorientbretagnesudtourisme.fr/fr/agenda/",
};
const lorientEvents = {
  id: "lorient-events",
  name: "Lorient Bretagne Sud Événements",
  url: "https://lorient-evenements.bzh/agenda/",
};

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("découvre et déduplique les candidats Tourisme sans confondre détail et réservation", async () => {
  const candidates = parseTourismCandidates(await fixture("tourism-list.html"), tourism);

  assert.deepEqual(candidates, [{
    title: "Fête des lumières",
    startsOn: "2026-12-12",
    venue: "Grand Théâtre",
    city: "Lorient",
    detailUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/fete-des-lumieres/",
    sourceId: "tourism",
  }]);
  assert.ok(candidates.every((candidate) => !("bookingUrl" in candidate)));
});

test("découvre seulement les fiches agenda Lorient Événements et ignore feed", async () => {
  assert.deepEqual(parseLorientEventsCandidates(await fixture("lorient-events-list.html"), lorientEvents), [{
    title: "Le grand soir",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/le-grand-soir/",
    sourceId: "lorient-events",
  }]);
});

test("refuse explicitement les signatures territoriales inattendues", () => {
  assert.throws(
    () => parseTourismCandidates("<main>Maintenance</main>", tourism),
    /Lorient Bretagne Sud Tourisme: signature Tourisme absente/,
  );
  assert.throws(
    () => parseLorientEventsCandidates("<main>Maintenance</main>", lorientEvents),
    /Lorient Bretagne Sud Événements: signature Lorient Événements absente/,
  );
});

test("ne résout pas un détail sans réservation HTTPS fiable", () => {
  const candidate = {
    title: "Spectacle sans réservation",
    startsOn: "2026-10-10",
    venue: "Le City",
    city: "Lorient",
    detailUrl: "https://agenda.example.test/spectacle-sans-reservation",
    sourceId: "tourism",
  };
  const html = '<a href="mailto:billetterie@example.test">Nous contacter</a><a href="tel:+33200000000">Téléphone</a>';

  assert.equal(findReservationUrl(html, candidate.detailUrl), null);
  assert.equal(resolveReservation(html, candidate), null);
});

test("écarte une foire professionnelle même avec une billetterie", async () => {
  const candidate = {
    title: "Salon des métiers 2026",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/salon-des-metiers/",
    sourceId: "lorient-events",
  };

  assert.equal(resolveReservation(await fixture("lorient-events-detail.html"), candidate), null);
});

test("transforme un spectacle familial réservé en Event strict", async () => {
  const candidate = parseTourismCandidates(await fixture("tourism-list.html"), tourism)[0];

  assert.deepEqual(resolveReservation(await fixture("tourism-detail.html"), candidate), {
    title: "Fête des lumières",
    startsOn: "2026-12-12",
    startsAt: null,
    venue: "Grand Théâtre",
    city: "Lorient",
    bookingUrl: "https://billetterie.example.test/fete-des-lumieres",
    sourceUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/fete-des-lumieres/",
    sourceId: "tourism",
  });
});
