import test from "node:test";
import assert from "node:assert/strict";

import { createEvent } from "../src/model.mjs";
import { getSource } from "../src/sources.mjs";
import { migrateCanonicalEventKeys } from "../src/canonical-keys.mjs";
import { emptyState, planTransition, validateState } from "../src/state.mjs";

const hydrophone = getSource("hydrophone");
const estran = getSource("mapado-estran");

function event(overrides = {}) {
  const created = createEvent({
    title: "Concert A",
    startsOn: "2026-10-15",
    startsAt: "20:30",
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-a",
    sourceUrl: "https://www.hydrophone.fr/concert-a.html",
    sourceId: "hydrophone",
    ...overrides,
  });
  return {
    ...created,
    sourceIds: overrides.sourceIds ?? [created.sourceId],
    sourceUrls: overrides.sourceUrls ?? [created.sourceUrl],
  };
}

function success(source, events, checkedAt) {
  return { source, events, checkedAt };
}

function baselineState(checkedAt = "2026-08-30T10:00:00.000Z") {
  return planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: checkedAt,
  }).state;
}

const staleId = "2026-09-08:56520:l-estran:presentation-de-saison-concert-harold-lopez-nussa";
const canonicalId = "2026-09-08:guidel:l-estran:presentation-de-saison-concert-harold-lopez-nussa";

function estranSeen(overrides = {}) {
  return {
    title: "Présentation de saison + concert Harold López-Nussa",
    startsOn: "2026-09-08",
    venue: "L'Estran",
    city: "56520",
    bookingUrl: "https://lestran-guidel.mapado.com/event/presentation-de-saison-concert-harold-lopez-nussa",
    notifiedAt: "2026-08-30T10:00:00.000Z",
    sourceIds: ["mapado-estran"],
    ...overrides,
  };
}

test("réécrit un identifiant historique fondé sur un code postal sans le rejeter", () => {
  const stale = structuredClone(baselineState());
  stale.seen[staleId] = estranSeen();

  const migrated = validateState(migrateCanonicalEventKeys(stale));
  assert.equal(migrated.seen[staleId], undefined);
  assert.deepEqual(migrated.seen[canonicalId], estranSeen());
  assert.equal(stale.seen[staleId].city, "56520");
});

test("fusionne une clé historique et sa forme canonique déjà présente", () => {
  const stale = structuredClone(baselineState());
  stale.seen[staleId] = estranSeen();
  stale.seen[canonicalId] = estranSeen({
    city: "Guidel",
    notifiedAt: null,
    sourceIds: ["lorient-events"],
  });

  const migrated = validateState(migrateCanonicalEventKeys(stale));
  assert.equal(migrated.seen[staleId], undefined);
  assert.equal(migrated.seen[canonicalId].notifiedAt, "2026-08-30T10:00:00.000Z");
  assert.deepEqual(migrated.seen[canonicalId].sourceIds, ["lorient-events", "mapado-estran"]);
});

test("retire de l'outbox une nouveauté déjà connue sous une clé historique", () => {
  const stale = structuredClone(baselineState());
  stale.seen[staleId] = estranSeen();
  stale.outbox.events[canonicalId] = {
    title: "Présentation de saison + concert Harold López-Nussa",
    startsOn: "2026-09-08",
    startsAt: null,
    venue: "L'Estran",
    city: "Guidel",
    bookingUrl: "https://lestran-guidel.mapado.com/event/presentation-de-saison-concert-harold-lopez-nussa",
    sourceUrl: "https://lestran-guidel.mapado.com/",
    sourceId: "mapado-estran",
    sourceIds: ["mapado-estran"],
    sourceUrls: ["https://lestran-guidel.mapado.com/"],
  };

  const migrated = validateState(migrateCanonicalEventKeys(stale));
  assert.equal(migrated.outbox.events[canonicalId], undefined);
  assert.ok(migrated.seen[canonicalId]);
});

test("un événement déjà vu sous un code postal n'est pas rejoué comme une nouveauté", () => {
  const laterAt = "2026-08-30T11:00:00.000Z";
  const stale = structuredClone(baselineState());
  stale.seen[staleId] = estranSeen();
  const migrated = validateState(migrateCanonicalEventKeys(stale));
  const current = event({
    title: "Présentation de saison + concert Harold López-Nussa",
    startsOn: "2026-09-08",
    startsAt: null,
    venue: "L'Estran",
    city: "Guidel",
    bookingUrl: "https://lestran-guidel.mapado.com/event/presentation-de-saison-concert-harold-lopez-nussa",
    sourceUrl: "https://lestran-guidel.mapado.com/",
    sourceId: "mapado-estran",
    sourceIds: ["mapado-estran"],
    sourceUrls: ["https://lestran-guidel.mapado.com/"],
  });

  const replayed = planTransition({
    state: migrated,
    successes: [success(estran, [current], laterAt)],
    failures: [],
    now: laterAt,
  });

  assert.deepEqual(replayed.newEvents, []);
  assert.deepEqual(replayed.state.outbox.events, {});
  assert.ok(replayed.state.seen[canonicalId]);
});
