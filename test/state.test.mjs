import test from "node:test";
import assert from "node:assert/strict";

import { canonicalEventId, createEvent } from "../src/model.mjs";
import { getSource } from "../src/sources.mjs";
import {
  acknowledgeNotifications,
  applyCollection,
  emptyState,
  planTransition,
  validateState,
} from "../src/state.mjs";

const hydrophone = getSource("hydrophone");
const tourism = getSource("tourism");

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

function failure(source, checkedAt, message = "source inaccessible") {
  return { source, message, checkedAt };
}

test("distingue un état absent d'un état présent mal formé", () => {
  const expected = {
    version: 1,
    initializedAt: null,
    updatedAt: null,
    seen: {},
    sources: {},
    candidates: {},
  };

  assert.deepEqual(emptyState(), expected);
  assert.deepEqual(validateState(undefined), expected);
  assert.throws(() => validateState({}), /État invalide/);
  assert.throws(() => validateState(null), /État invalide/);
  assert.throws(() => validateState({ ...expected, version: 2 }), /version/i);
});

test("initialise silencieusement une source et inscrit ses événements observés", () => {
  const initial = emptyState();
  const observed = event();
  const checkedAt = "2026-08-30T10:00:00.000Z";

  const transition = planTransition({
    state: initial,
    successes: [success(hydrophone, [observed], checkedAt)],
    failures: [],
    now: checkedAt,
  });

  const id = "2026-10-15:lorient:hydrophone:concert-a";
  assert.equal(canonicalEventId(observed), id);
  assert.deepEqual(transition.newEvents, []);
  assert.deepEqual(transition.initializedSources, [hydrophone]);
  assert.deepEqual(transition.state.seen[id], {
    title: "Concert A",
    startsOn: "2026-10-15",
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-a",
    notifiedAt: null,
    sourceIds: ["hydrophone"],
  });
  assert.deepEqual(transition.state.sources.hydrophone, {
    initializedAt: checkedAt,
    lastSuccessAt: checkedAt,
    lastCheckedAt: checkedAt,
    consecutiveFailures: 0,
    incidentOpen: false,
  });
  assert.equal(transition.state.initializedAt, checkedAt);
  assert.equal(transition.state.updatedAt, checkedAt);
  assert.deepEqual(initial, emptyState());
});

test("ne mémorise une nouveauté qu'après son acquittement de notification", () => {
  const firstAt = "2026-08-30T10:00:00.000Z";
  const secondAt = "2026-08-30T10:15:00.000Z";
  const notifiedAt = "2026-08-30T10:16:00.000Z";
  const baseline = applyCollection({
    state: emptyState(),
    successes: [success(hydrophone, [event()], firstAt)],
    failures: [],
    now: firstAt,
  });
  const newcomer = event({
    title: "Concert B",
    startsOn: "2026-10-16",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-b",
    sourceUrl: "https://www.hydrophone.fr/concert-b.html",
  });
  const newcomerId = "2026-10-16:lorient:hydrophone:concert-b";

  const planned = planTransition({
    state: baseline.state,
    successes: [success(hydrophone, [event(), newcomer], secondAt)],
    failures: [],
    now: secondAt,
  });

  assert.deepEqual(planned.newEvents, [newcomer]);
  assert.equal(planned.state.seen[newcomerId], undefined);
  assert.deepEqual(baseline.state.sources.hydrophone.lastCheckedAt, firstAt);

  const acknowledged = acknowledgeNotifications(planned, [newcomerId], notifiedAt);
  assert.equal(acknowledged.state.seen[newcomerId].notifiedAt, notifiedAt);
  assert.deepEqual(acknowledged.state.seen[newcomerId].sourceIds, ["hydrophone"]);
});

test("un acquittement partiel garde les pairs échoués retentables et le cache candidat durable", () => {
  const firstAt = "2026-08-30T10:00:00.000Z";
  const checkedAt = "2026-08-30T10:15:00.000Z";
  const notifiedAt = "2026-08-30T10:16:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], firstAt)],
    failures: [],
    now: firstAt,
  });
  const concertB = event({
    title: "Concert B",
    startsOn: "2026-10-16",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-b",
    sourceUrl: "https://www.hydrophone.fr/concert-b.html",
  });
  const concertC = event({
    title: "Concert C",
    startsOn: "2026-10-17",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-c",
    sourceUrl: "https://www.hydrophone.fr/concert-c.html",
  });
  const candidateUrl = "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert-cache/";

  const planned = planTransition({
    state: baseline.state,
    successes: [success(hydrophone, [event(), concertB, concertC], checkedAt)],
    failures: [],
    candidateUpdates: {
      [candidateUrl]: { checkedAt, event: null },
    },
    now: checkedAt,
  });
  const acknowledged = acknowledgeNotifications(
    planned,
    ["2026-10-16:lorient:hydrophone:concert-b"],
    notifiedAt,
  );

  assert.ok(acknowledged.state.seen["2026-10-16:lorient:hydrophone:concert-b"]);
  assert.equal(acknowledged.state.seen["2026-10-17:lorient:hydrophone:concert-c"], undefined);
  assert.deepEqual(acknowledged.state.candidates[candidateUrl], { checkedAt, event: null });

  const retry = planTransition({
    state: acknowledged.state,
    successes: [success(hydrophone, [event(), concertB, concertC], "2026-08-30T10:30:00.000Z")],
    failures: [],
    now: "2026-08-30T10:30:00.000Z",
  });
  assert.deepEqual(retry.newEvents, [concertC]);
});

test("conserve toutes les sources d'une nouveauté partagée lors de l'acquittement", () => {
  const baselineAt = "2026-08-30T10:00:00.000Z";
  const checkedAt = "2026-08-30T11:00:00.000Z";
  const notifiedAt = "2026-08-30T11:01:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], baselineAt)],
    failures: [],
    now: baselineAt,
  });
  const hydroEvent = event({
    title: "Concert partagé",
    startsOn: "2026-10-20",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-partage",
    sourceUrl: "https://www.hydrophone.fr/concert-partage.html",
  });
  const tourismEvent = event({
    title: "Concert partagé",
    startsOn: "2026-10-20",
    bookingUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert-partage/",
    sourceUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert-partage/",
    sourceId: "tourism",
  });
  const id = "2026-10-20:lorient:hydrophone:concert-partage";

  const planned = planTransition({
    state: baseline.state,
    successes: [
      success(hydrophone, [hydroEvent], checkedAt),
      success(tourism, [tourismEvent], checkedAt),
    ],
    failures: [],
    now: checkedAt,
  });
  const acknowledged = acknowledgeNotifications(planned, [id], notifiedAt);

  assert.equal(planned.newEvents.length, 1);
  assert.deepEqual(planned.newEvents[0].sourceIds, ["hydrophone", "tourism"]);
  assert.deepEqual(acknowledged.state.seen[id].sourceIds, ["hydrophone", "tourism"]);
});

test("ouvre un seul incident au quatrième échec puis le ferme au premier succès", () => {
  let state = emptyState();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const checkedAt = `2026-08-30T1${attempt}:00:00.000Z`;
    const transition = planTransition({
      state,
      successes: [],
      failures: [failure(tourism, checkedAt)],
      now: checkedAt,
    });
    assert.equal(transition.incidents.length, attempt === 4 ? 1 : 0);
    if (attempt === 4) {
      assert.equal(transition.incidents[0].source, tourism);
      assert.equal(transition.incidents[0].consecutiveFailures, 4);
    }
    state = transition.state;
  }

  assert.equal(state.sources.tourism.consecutiveFailures, 5);
  assert.equal(state.sources.tourism.incidentOpen, true);

  const recoveredAt = "2026-08-30T16:00:00.000Z";
  const recovered = planTransition({
    state,
    successes: [success(tourism, [], recoveredAt)],
    failures: [],
    now: recoveredAt,
  });
  assert.deepEqual(recovered.recoveries, [{ source: tourism, checkedAt: recoveredAt }]);
  assert.equal(recovered.state.sources.tourism.consecutiveFailures, 0);
  assert.equal(recovered.state.sources.tourism.incidentOpen, false);

  const nextAt = "2026-08-30T17:00:00.000Z";
  const next = planTransition({
    state: recovered.state,
    successes: [success(tourism, [], nextAt)],
    failures: [],
    now: nextAt,
  });
  assert.deepEqual(next.recoveries, []);
});

test("l'échec d'une source ne l'initialise pas et ne vide pas les événements existants", () => {
  const baselineAt = "2026-08-30T10:00:00.000Z";
  const failedAt = "2026-08-30T11:00:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], baselineAt)],
    failures: [],
    now: baselineAt,
  });

  const failed = planTransition({
    state: baseline.state,
    successes: [],
    failures: [failure(tourism, failedAt)],
    now: failedAt,
  });

  assert.deepEqual(failed.initializedSources, []);
  assert.deepEqual(failed.state.seen, baseline.state.seen);
  assert.deepEqual(failed.state.sources.tourism, {
    initializedAt: null,
    lastSuccessAt: null,
    lastCheckedAt: failedAt,
    consecutiveFailures: 1,
    incidentOpen: false,
  });
});

test("refuse les incohérences temporelles, identifiants étrangers et URL non autorisées", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const valid = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: checkedAt,
  }).state;
  const seenId = canonicalEventId(event());
  const mutations = [
    { ...valid, initializedAt: "2026-08-30T11:00:00.000Z" },
    {
      ...valid,
      sources: {
        ...valid.sources,
        hydrophone: { ...valid.sources.hydrophone, lastSuccessAt: "2026-08-30T11:00:00.000Z" },
      },
    },
    { ...valid, sources: { ...valid.sources, "source-étrangère": valid.sources.hydrophone } },
    {
      ...valid,
      seen: {
        ...valid.seen,
        [seenId]: { ...valid.seen[seenId], bookingUrl: "http://www.hydrophone.fr/concert-a" },
      },
    },
    {
      ...valid,
      candidates: {
        "https://evil.example.test/agenda/concert": { checkedAt, event: null },
      },
    },
  ];

  for (const malformed of mutations) {
    assert.throws(() => validateState(malformed), /État invalide/);
  }
});
