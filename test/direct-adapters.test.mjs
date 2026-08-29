import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTheatreLorient } from "../src/adapters/theatre-lorient.mjs";
import { parseHydrophone } from "../src/adapters/hydrophone.mjs";
import { parseTrios } from "../src/adapters/trios.mjs";
import { parseFil } from "../src/adapters/fil.mjs";

const theatre = {
  id: "theatre-lorient",
  name: "Théâtre de Lorient",
  url: "https://theatredelorient.fr/saison/",
  city: "Lorient",
  venue: "Théâtre de Lorient",
};
const hydrophone = {
  id: "hydrophone",
  name: "Hydrophone",
  url: "https://www.hydrophone.fr/-La-programmation-2026-.html",
  city: "Lorient",
  venue: "Hydrophone",
};
const trios = {
  id: "trios",
  name: "TRIO…S",
  url: "https://www.vostickets.net/billet?id=TRIO",
  city: null,
  venue: "TRIO…S",
};
const fil = {
  id: "fil",
  name: "Festival Interceltique de Lorient",
  url: "https://www.festival-interceltique.bzh/billetterie-2026/",
  city: "Lorient",
  venue: "Festival Interceltique",
};

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("extrait la vente officielle du Théâtre de Lorient sans retenir la navigation", async () => {
  assert.deepEqual(parseTheatreLorient(await fixture("theatre-lorient.html"), theatre), [{
    title: "Une pièce à Lorient",
    startsOn: "2099-10-12",
    startsAt: null,
    venue: "Grand Théâtre",
    city: "Lorient",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/une-piece-a-lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/une-piece-a-lorient/",
    sourceId: "theatre-lorient",
  }]);
});

test("extrait la vente Hydrophone depuis une fiche programme hors navigation", async () => {
  assert.deepEqual(parseHydrophone(await fixture("hydrophone.html"), hydrophone), [{
    title: "Concert très attendu",
    startsOn: "2099-11-14",
    startsAt: null,
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://billetterie.hydrophone.fr/evenement/concert-tres-attendu",
    sourceUrl: "https://www.hydrophone.fr/concert-tres-attendu.html",
    sourceId: "hydrophone",
  }]);
});

test("extrait seulement la carte TRIO…S liée à une action de réservation Vostickets", async () => {
  assert.deepEqual(parseTrios(await fixture("trios.html"), trios), [{
    title: "Danse à Pont-Scorff",
    startsOn: "2099-12-03",
    startsAt: null,
    venue: "Le City",
    city: "Pont-Scorff",
    bookingUrl: "https://www.vostickets.net/billet?ID=TRIO&SPC=8842",
    sourceUrl: "https://www.vostickets.net/billet?id=TRIO",
    sourceId: "trios",
  }]);
});

test("extrait seulement le lien de réservation externe officiel du FIL", async () => {
  assert.deepEqual(parseFil(await fixture("fil.html"), fil), [{
    title: "Nuit interceltique",
    startsOn: "2099-08-08",
    startsAt: null,
    venue: "Espace Jean-Pierre Pichard",
    city: "Lorient",
    bookingUrl: "https://reelax-tickets.com/e/n/nuit-interceltique-2099",
    sourceUrl: "https://www.festival-interceltique.bzh/billetterie-2026/",
    sourceId: "fil",
  }]);
});

test("retourne une liste vide seulement pour une page officielle qui annonce explicitement l'absence de vente", () => {
  assert.deepEqual(parseTheatreLorient("<h1>Saison</h1><p>Aucun spectacle actuellement en vente.</p>", theatre), []);
  assert.deepEqual(parseHydrophone("<h1>Agenda</h1><p>Aucun concert actuellement en vente.</p>", hydrophone), []);
  assert.deepEqual(parseTrios('<a href="https://trio-s.fr/">TRIO…S</a><p>Aucun spectacle actuellement en vente.</p>', trios), []);
  assert.deepEqual(parseFil("<h1>Billetterie</h1><p>Aucun spectacle actuellement en vente.</p>", fil), []);
});

test("écarte les cartes officielles dont la date est déjà passée", async () => {
  for (const [parse, name, source] of [
    [parseTheatreLorient, "theatre-lorient.html", theatre],
    [parseHydrophone, "hydrophone.html", hydrophone],
    [parseTrios, "trios.html", trios],
    [parseFil, "fil.html", fil],
  ]) {
    const pastPage = (await fixture(name)).replaceAll("2099", "2000");
    assert.deepEqual(parse(pastPage, source), []);
  }
});

test("refuse explicitement une page qui ne porte pas la signature officielle attendue", () => {
  for (const [parse, source] of [
    [parseTheatreLorient, theatre],
    [parseHydrophone, hydrophone],
    [parseTrios, trios],
    [parseFil, fil],
  ]) {
    assert.throws(
      () => parse("<form><input type=\"password\"></form>", source),
      new RegExp(`${source.name}: signature officielle absente`),
    );
  }
});

test("contextualise un lien cassé dans une signature par ailleurs reconnaissable", () => {
  assert.throws(
    () => parseTheatreLorient('<article><a href="https://[cassé">Spectacle</a></article>', theatre),
    /Théâtre de Lorient: signature officielle absente/,
  );
  assert.throws(
    () => parseHydrophone('<article><a href="https://[cassé">Concert</a></article>', hydrophone),
    /Hydrophone: signature officielle absente/,
  );
  assert.throws(
    () => parseTrios('<a href="https://[cassé">TRIO…S</a>', trios),
    /TRIO…S: signature officielle absente/,
  );
  assert.throws(
    () => parseFil('<h1>Billetterie</h1><article><a href="https://[cassé">Réserver</a></article>', fil),
    /Festival Interceltique de Lorient: signature officielle absente/,
  );
});
