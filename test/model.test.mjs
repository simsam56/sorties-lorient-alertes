import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEventId,
  createEvent,
  parseFrenchDate,
} from "../src/model.mjs";

test("normalise un événement sans perdre son lien officiel", () => {
  const event = createEvent({
    title: "  ÉMILY LOIZEAU & Quatuor Debussy ",
    startsOn: "2026-10-15",
    startsAt: null,
    venue: "Grand Théâtre",
    city: "Lorient",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/123",
    sourceUrl: "https://theatredelorient.fr/spectacle/emily-loizeau/",
    sourceId: "theatre-lorient",
  });
  assert.equal(event.title, "ÉMILY LOIZEAU & Quatuor Debussy");
  assert.match(canonicalEventId(event), /^2026-10-15:lorient:theatre-de-lorient:/);
});

test("stabilise l'identité canonique pour tous les alias de salles connus", () => {
  const identityAt = (venue) => canonicalEventId(createEvent({
    title: "Concert témoin",
    startsOn: "2026-10-15",
    startsAt: null,
    venue,
    city: "Lorient",
    bookingUrl: "https://example.test/reservation",
    sourceUrl: "https://example.test/evenement",
    sourceId: "theatre-lorient",
  }));

  assert.equal(identityAt("Grand Théâtre"), identityAt("Théâtre de Lorient"));
  assert.equal(identityAt("Grand Théâtre de Lorient"), identityAt("Théâtre de Lorient"));
  assert.equal(identityAt("Salle Keragan"), identityAt("Océanis"));
});

test("comprend une date française", () => {
  assert.equal(parseFrenchDate("Sam. 26 sept. 2026 à 20:30"), "2026-09-26");
  assert.equal(parseFrenchDate("Le 8 décembre 2026"), "2026-12-08");
});

test("refuse un événement sans réservation HTTPS", () => {
  assert.throws(
    () => createEvent({
      title: "Concert",
      startsOn: "2026-10-15",
      startsAt: null,
      venue: "Hydrophone",
      city: "Lorient",
      bookingUrl: "mailto:billetterie@example.test",
      sourceUrl: "https://www.hydrophone.fr/concert.html",
      sourceId: "hydrophone",
    }),
    /Événement invalide/,
  );
});
