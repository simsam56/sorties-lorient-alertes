import test from "node:test";
import assert from "node:assert/strict";
import { createEvent } from "../src/model.mjs";
import { deduplicateEvents } from "../src/dedupe.mjs";

function event(overrides) {
  return createEvent({
    title: "Concert témoin",
    startsOn: "2026-10-15",
    startsAt: null,
    venue: "Théâtre de Lorient",
    city: "Lorient",
    bookingUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert/",
    sourceUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert/",
    sourceId: "tourism",
    ...overrides,
  });
}

test("fusionne les mêmes spectacle, date et lieu et garde la billetterie directe", () => {
  const tourism = event({
    title: "Emily Loizeau & Quatuor Debussy",
    startsAt: "20:30",
    venue: "Grand Théâtre",
    sourceUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/emily-loizeau/",
    bookingUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/emily-loizeau/",
  });
  const theatre = event({
    title: "EMILY LOIZEAU + QUATUOR DEBUSSY",
    venue: "Théâtre de Lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/emily-loizeau/",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/emily-loizeau",
    sourceId: "theatre-lorient",
  });

  const events = deduplicateEvents([tourism, theatre]);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].sourceIds, ["theatre-lorient", "tourism"]);
  assert.deepEqual(events[0].sourceUrls, [
    "https://theatredelorient.fr/spectacle/emily-loizeau/",
    "https://www.lorientbretagnesudtourisme.fr/fr/fiche/emily-loizeau/",
  ]);
  assert.equal(events[0].bookingUrl, "https://billetterie.theatredelorient.fr/event/emily-loizeau");
  assert.equal(events[0].startsAt, "20:30");
  assert.equal(tourism.sourceIds, undefined);
  assert.equal(theatre.sourceUrls, undefined);
});

test("ne fusionne jamais deux dates différentes", () => {
  const events = deduplicateEvents([
    event({ title: "Emily Loizeau", startsOn: "2026-10-15" }),
    event({ title: "EMILY LOIZEAU", startsOn: "2026-10-16", sourceId: "theatre-lorient" }),
  ]);

  assert.equal(events.length, 2);
});

test("produit la même fusion quelle que soit la permutation des sources ex aequo", () => {
  const first = event({
    title: "Miossec",
    sourceId: "theatre-lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/miossec/",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/miossec-a",
  });
  const second = event({
    title: "MIOSSEC",
    sourceId: "theatre-lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/miossec/",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/miossec-b",
  });

  assert.deepEqual(
    deduplicateEvents([first, second]),
    deduplicateEvents([second, first]),
  );
});

test("ne fusionne pas deux représentations aux horaires connus différents", () => {
  const events = deduplicateEvents([
    event({ title: "Miossec", startsAt: "18:00" }),
    event({ title: "MIOSSEC", startsAt: "21:00", sourceId: "theatre-lorient" }),
  ]);

  assert.equal(events.length, 2);
});

test("normalise un préfixe organisateur sans séparateur sans altérer un vrai titre", () => {
  const organized = event({
    title: "Le Grand Théâtre présente Emily Loizeau",
    sourceId: "theatre-lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/emily-loizeau/",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/emily-loizeau",
  });
  const plain = event({ title: "Emily Loizeau" });
  const separated = event({
    title: "La Ville de Lorient présente — Emily Loizeau",
    sourceId: "city-culture",
    sourceUrl: "https://example.test/culture/emily-loizeau",
    bookingUrl: "https://example.test/culture/emily-loizeau",
  });
  const actualTitle = event({
    title: "Emily présente Bob",
    startsOn: "2026-10-16",
    sourceId: "theatre-lorient",
    sourceUrl: "https://theatredelorient.fr/spectacle/emily-presente-bob/",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/emily-presente-bob",
  });

  const events = deduplicateEvents([organized, plain, separated, actualTitle]);

  assert.equal(events.length, 2);
  assert.equal(events.find((candidate) => candidate.startsOn === "2026-10-15").title, "Emily Loizeau");
  assert.equal(events.find((candidate) => candidate.startsOn === "2026-10-16").title, "Emily présente Bob");
});

test("reconnaît les deux appellations connues d'Océanis", () => {
  const events = deduplicateEvents([
    event({
      title: "Miossec",
      venue: "Salle Keragan",
      city: "Ploemeur",
    }),
    event({
      title: "MIOSSEC",
      venue: "Océanis",
      city: "Ploemeur",
      sourceId: "mapado-oceanis",
      sourceUrl: "https://billetterieoceanis.mapado.com/event/miossec",
      bookingUrl: "https://billetterieoceanis.mapado.com/event/miossec",
    }),
  ]);

  assert.equal(events.length, 1);
});

test("conserve les événements lorsque l'identité titre-date-lieu-commune est incertaine", () => {
  const events = deduplicateEvents([
    event({ title: "Présentation de saison", venue: "Théâtre de Lorient" }),
    event({ title: "Présentation de saison", venue: "Hydrophone", sourceId: "hydrophone" }),
    event({ title: "Concert de rentrée", venue: "Hydrophone", sourceId: "hydrophone" }),
    event({ title: "Festival Interceltique", venue: "Espace Cosmao", city: "Lorient" }),
    event({
      title: "Festival Interceltique - ouverture",
      venue: "Espace culturel",
      city: "Lanester",
      sourceId: "lanester-culture",
      sourceUrl: "https://example.test/lanester-festival",
      bookingUrl: "https://example.test/lanester-festival",
    }),
  ]);

  assert.equal(events.length, 5);
});
