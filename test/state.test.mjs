import test from "node:test";
import assert from "node:assert/strict";

import { canonicalEventId, createEvent } from "../src/model.mjs";
import { getSource } from "../src/sources.mjs";
import {
  acknowledgeHealthNotifications,
  acknowledgeNotifications,
  applyCollection,
  emptyState,
  planTransition,
  validateState,
} from "../src/state.mjs";

const hydrophone = getSource("hydrophone");
const tourism = getSource("tourism");
const oceanis = getSource("mapado-oceanis");

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
    version: 2,
    initializedAt: null,
    updatedAt: null,
    seen: {},
    sources: {},
    candidates: {},
    outbox: { events: {}, health: {} },
  };

  assert.deepEqual(emptyState(), expected);
  assert.deepEqual(validateState(undefined), expected);
  assert.throws(() => validateState({}), /État invalide/);
  assert.throws(() => validateState(null), /État invalide/);
  assert.throws(() => validateState({ ...expected, version: 1 }), /version/i);
  assert.throws(() => validateState({ ...expected, version: 3 }), /version/i);
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
  const { lastResultFingerprint, ...sourceState } = transition.state.sources.hydrophone;
  assert.match(lastResultFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(sourceState, {
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
  assert.deepEqual(planned.state.outbox.events[newcomerId], newcomer);
  assert.deepEqual(baseline.state.sources.hydrophone.lastCheckedAt, firstAt);

  const acknowledged = acknowledgeNotifications(planned, [newcomerId], notifiedAt);
  assert.equal(acknowledged.state.seen[newcomerId].notifiedAt, notifiedAt);
  assert.deepEqual(acknowledged.state.seen[newcomerId].sourceIds, ["hydrophone"]);
  assert.equal(acknowledged.state.outbox.events[newcomerId], undefined);
});

test("un événement acquitté reste connu si une lecture suivante emploie un alias du lieu", () => {
  const oceanisEvent = (venue) => event({
    title: "Miossec",
    startsOn: "2026-10-16",
    venue,
    city: "Ploemeur",
    sourceId: oceanis.id,
    sourceIds: [oceanis.id],
    sourceUrl: "https://billetterieoceanis.mapado.com/event/miossec",
    sourceUrls: ["https://billetterieoceanis.mapado.com/event/miossec"],
    bookingUrl: "https://billetterieoceanis.mapado.com/event/miossec",
  });
  const baselineAt = "2026-08-30T10:00:00.000Z";
  const detectedAt = "2026-08-30T10:15:00.000Z";
  const acknowledgedAt = "2026-08-30T10:16:00.000Z";
  const aliasedAt = "2026-08-30T10:30:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(oceanis, [], baselineAt)],
    failures: [],
    now: baselineAt,
  });
  const detected = planTransition({
    state: baseline.state,
    successes: [success(oceanis, [oceanisEvent("Océanis")], detectedAt)],
    failures: [],
    now: detectedAt,
  });
  const id = canonicalEventId(oceanisEvent("Océanis"));
  const acknowledged = acknowledgeNotifications(detected, [id], acknowledgedAt);

  const aliased = planTransition({
    state: acknowledged.state,
    successes: [success(oceanis, [oceanisEvent("Salle Keragan")], aliasedAt)],
    failures: [],
    now: aliasedAt,
  });

  assert.equal(id, "2026-10-16:ploemeur:oceanis:miossec");
  assert.deepEqual(aliased.newEvents, []);
  assert.deepEqual(aliased.state.outbox.events, {});
  assert.equal(Object.keys(aliased.state.seen).length, 1);
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
  assert.equal(acknowledged.state.outbox.events["2026-10-16:lorient:hydrophone:concert-b"], undefined);
  assert.deepEqual(
    acknowledged.state.outbox.events["2026-10-17:lorient:hydrophone:concert-c"],
    concertC,
  );
  assert.deepEqual(acknowledged.state.candidates[candidateUrl], { checkedAt, event: null });

  const retry = planTransition({
    state: acknowledged.state,
    successes: [success(hydrophone, [event(), concertB, concertC], "2026-08-30T10:30:00.000Z")],
    failures: [],
    now: "2026-08-30T10:30:00.000Z",
  });
  assert.deepEqual(retry.newEvents, []);
  assert.deepEqual(retry.state.outbox.events, {
    "2026-10-17:lorient:hydrophone:concert-c": concertC,
  });
});

test("conserve une nouveauté pending si la source la retire puis évite de la dupliquer à son retour", () => {
  const baselineAt = "2026-08-30T10:00:00.000Z";
  const newcomer = event({
    title: "Concert éphémère",
    startsOn: "2026-10-18",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-ephemere",
    sourceUrl: "https://www.hydrophone.fr/concert-ephemere.html",
  });
  const id = canonicalEventId(newcomer);
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], baselineAt)],
    now: baselineAt,
  });
  const detected = planTransition({
    state: baseline.state,
    successes: [success(hydrophone, [event(), newcomer], "2026-08-30T10:15:00.000Z")],
    now: "2026-08-30T10:15:00.000Z",
  });
  const disappeared = planTransition({
    state: detected.state,
    successes: [success(hydrophone, [event()], "2026-08-30T10:30:00.000Z")],
    now: "2026-08-30T10:30:00.000Z",
  });
  const returned = planTransition({
    state: disappeared.state,
    successes: [success(hydrophone, [event(), newcomer], "2026-08-30T10:45:00.000Z")],
    now: "2026-08-30T10:45:00.000Z",
  });

  assert.deepEqual(detected.newEvents, [newcomer]);
  assert.deepEqual(disappeared.newEvents, []);
  assert.deepEqual(returned.newEvents, []);
  assert.deepEqual(Object.keys(returned.state.outbox.events), [id]);
  assert.deepEqual(returned.state.outbox.events[id], newcomer);
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
  let lastFailure;
  const incidentId = "incident:tourism:2026-08-30T14:00:00.000Z";

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
    lastFailure = transition;
    state = transition.state;
  }

  assert.equal(state.sources.tourism.consecutiveFailures, 5);
  assert.equal(state.sources.tourism.incidentOpen, true);
  assert.deepEqual(state.outbox.health, {
    [incidentId]: {
      kind: "incident",
      sourceId: "tourism",
      consecutiveFailures: 4,
      queuedAt: "2026-08-30T14:00:00.000Z",
    },
  });

  const incidentAcknowledged = acknowledgeHealthNotifications(
    lastFailure,
    [incidentId],
    "2026-08-30T15:01:00.000Z",
  );
  assert.deepEqual(incidentAcknowledged.state.outbox.health, {});

  const recoveredAt = "2026-08-30T16:00:00.000Z";
  const recoveryId = `recovery:tourism:${recoveredAt}`;
  const recovered = planTransition({
    state: incidentAcknowledged.state,
    successes: [success(tourism, [], recoveredAt)],
    failures: [],
    now: recoveredAt,
  });
  assert.deepEqual(recovered.recoveries, [{ source: tourism, checkedAt: recoveredAt }]);
  assert.equal(recovered.state.sources.tourism.consecutiveFailures, 0);
  assert.equal(recovered.state.sources.tourism.incidentOpen, false);
  assert.deepEqual(recovered.state.outbox.health, {
    [recoveryId]: {
      kind: "recovery",
      sourceId: "tourism",
      consecutiveFailures: null,
      queuedAt: recoveredAt,
    },
  });

  const nextAt = "2026-08-30T17:00:00.000Z";
  const next = planTransition({
    state: recovered.state,
    successes: [success(tourism, [], nextAt)],
    failures: [],
    now: nextAt,
  });
  assert.deepEqual(next.recoveries, []);
  assert.deepEqual(next.state.outbox.health, recovered.state.outbox.health);

  const recoveryAcknowledged = acknowledgeHealthNotifications(
    next,
    [recoveryId],
    "2026-08-30T17:01:00.000Z",
  );
  assert.deepEqual(recoveryAcknowledged.state.outbox.health, {});
});

test("conserve chaque transition santé non acquittée sur plusieurs cycles et retire seulement l'ID acquitté", () => {
  let state = emptyState();
  const applyFailure = (checkedAt) => {
    const transition = planTransition({
      state,
      failures: [failure(tourism, checkedAt)],
      now: checkedAt,
    });
    state = transition.state;
    return transition;
  };
  const applySuccess = (checkedAt) => {
    const transition = planTransition({
      state,
      successes: [success(tourism, [], checkedAt)],
      now: checkedAt,
    });
    state = transition.state;
    return transition;
  };

  for (const checkedAt of [
    "2026-08-30T10:00:00.000Z",
    "2026-08-30T11:00:00.000Z",
    "2026-08-30T12:00:00.000Z",
    "2026-08-30T13:00:00.000Z",
  ]) applyFailure(checkedAt);
  applySuccess("2026-08-30T14:00:00.000Z");
  for (const checkedAt of [
    "2026-08-30T15:00:00.000Z",
    "2026-08-30T16:00:00.000Z",
    "2026-08-30T17:00:00.000Z",
    "2026-08-30T18:00:00.000Z",
  ]) applyFailure(checkedAt);

  const firstIncidentId = "incident:tourism:2026-08-30T13:00:00.000Z";
  const firstRecoveryId = "recovery:tourism:2026-08-30T14:00:00.000Z";
  const secondIncidentId = "incident:tourism:2026-08-30T18:00:00.000Z";
  assert.deepEqual(Object.keys(state.outbox.health), [
    firstIncidentId,
    firstRecoveryId,
    secondIncidentId,
  ]);
  assert.deepEqual(Object.values(state.outbox.health).map(({ kind }) => kind), [
    "incident",
    "recovery",
    "incident",
  ]);
  const fixedKeyState = structuredClone(state);
  fixedKeyState.outbox.health["incident:tourism"] = fixedKeyState.outbox.health[firstIncidentId];
  delete fixedKeyState.outbox.health[firstIncidentId];
  assert.throws(() => validateState(fixedKeyState), /identifiant d'outbox santé incohérent/u);

  const replay = planTransition({
    state,
    failures: [failure(tourism, "2026-08-30T18:00:00.000Z")],
    now: "2026-08-30T18:05:00.000Z",
  });
  assert.deepEqual(replay.state.outbox.health, state.outbox.health);

  const middleAcknowledged = acknowledgeHealthNotifications(
    replay,
    [firstRecoveryId],
    "2026-08-30T18:06:00.000Z",
  );
  assert.deepEqual(Object.keys(middleAcknowledged.state.outbox.health), [
    firstIncidentId,
    secondIncidentId,
  ]);
  state = middleAcknowledged.state;

  const secondRecovery = applySuccess("2026-08-30T19:00:00.000Z");
  const secondRecoveryId = "recovery:tourism:2026-08-30T19:00:00.000Z";
  assert.deepEqual(Object.keys(secondRecovery.state.outbox.health), [
    firstIncidentId,
    secondIncidentId,
    secondRecoveryId,
  ]);
});

test("un même échec rejoué quatre fois au même checkedAt reste un seul échec", () => {
  const checkedAt = "2026-08-30T11:00:00.000Z";
  const first = planTransition({
    state: emptyState(),
    successes: [],
    failures: [failure(tourism, checkedAt)],
    now: checkedAt,
  });
  const stableState = structuredClone(first.state);
  let state = first.state;

  for (let replay = 1; replay <= 4; replay += 1) {
    const transition = planTransition({
      state,
      successes: [],
      failures: [failure(tourism, checkedAt)],
      now: `2026-08-30T1${replay + 1}:00:00.000Z`,
    });
    assert.deepEqual(transition.state, stableState);
    assert.deepEqual(transition.incidents, []);
    assert.deepEqual(transition.recoveries, []);
    state = transition.state;
  }

  assert.equal(state.sources.tourism.consecutiveFailures, 1);
  assert.equal(state.sources.tourism.incidentOpen, false);
});

test("un succès identique rejoué au même checkedAt est un no-op strict", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: checkedAt,
  });
  const snapshot = structuredClone(baseline.state);

  const replay = planTransition({
    state: baseline.state,
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: "2026-08-30T10:15:00.000Z",
  });

  assert.deepEqual(replay.state, snapshot);
  assert.deepEqual(replay.newEvents, []);
  assert.deepEqual(replay.initializedSources, []);
  assert.deepEqual(baseline.state, snapshot);
});

test("rejette à checkedAt égal un succès dont le contenu ou la provenance diffère", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const concertA = event();
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [concertA], checkedAt)],
    failures: [],
    now: checkedAt,
  });
  const snapshot = structuredClone(baseline.state);
  const concertB = event({
    title: "Concert B",
    startsOn: "2026-10-16",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-b",
    sourceUrl: "https://www.hydrophone.fr/concert-b.html",
  });
  const changedProvenance = {
    ...concertA,
    sourceIds: ["hydrophone", "tourism"],
    sourceUrls: [
      concertA.sourceUrl,
      "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert-a/",
    ],
  };

  for (const replayedEvents of [[concertB], [changedProvenance]]) {
    assert.throws(
      () => planTransition({
        state: baseline.state,
        successes: [success(hydrophone, replayedEvents, checkedAt)],
        failures: [],
        now: "2026-08-30T10:05:00.000Z",
      }),
      /Résultat contradictoire.*hydrophone/u,
    );
    assert.deepEqual(baseline.state, snapshot);
  }
});

test("inclut la source primaire dans le fingerprint malgré des tableaux agrégés identiques", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const hydrophoneUrl = "https://www.hydrophone.fr/concert-a.html";
  const tourismUrl = "https://www.lorientbretagnesudtourisme.fr/fr/fiche/concert-a/";
  const sourceIds = ["hydrophone", "tourism"];
  const sourceUrls = [hydrophoneUrl, tourismUrl];
  const primaryHydrophone = event({ sourceIds, sourceUrls, sourceUrl: hydrophoneUrl });
  const primaryTourism = {
    ...primaryHydrophone,
    sourceId: "tourism",
    sourceUrl: tourismUrl,
  };
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [primaryHydrophone], checkedAt)],
    failures: [],
    now: checkedAt,
  });
  const snapshot = structuredClone(baseline.state);

  assert.throws(
    () => planTransition({
      state: baseline.state,
      successes: [success(hydrophone, [primaryTourism], checkedAt)],
      failures: [],
      now: "2026-08-30T10:05:00.000Z",
    }),
    /Résultat contradictoire.*hydrophone/u,
  );
  assert.deepEqual(baseline.state, snapshot);
});

test("normalise l'ordre des événements avant de comparer un replay de succès", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const concertA = event();
  const concertB = event({
    title: "Concert B",
    startsOn: "2026-10-16",
    bookingUrl: "https://www.hydrophone.fr/billetterie/concert-b",
    sourceUrl: "https://www.hydrophone.fr/concert-b.html",
  });
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [concertA, concertB], checkedAt)],
    failures: [],
    now: checkedAt,
  });
  const snapshot = structuredClone(baseline.state);

  const replay = planTransition({
    state: baseline.state,
    successes: [success(hydrophone, [concertB, concertA], checkedAt)],
    failures: [],
    now: "2026-08-30T10:05:00.000Z",
  });

  assert.deepEqual(replay.state, snapshot);
});

test("rejette un replay de succès invalide avant de consulter son fingerprint", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const baseline = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: checkedAt,
  });
  const snapshot = structuredClone(baseline.state);
  const invalidEvent = {
    ...event(),
    bookingUrl: "http://www.hydrophone.fr/billetterie/concert-a",
  };

  assert.throws(
    () => planTransition({
      state: baseline.state,
      successes: [success(hydrophone, [invalidEvent], checkedAt)],
      failures: [],
      now: "2026-08-30T10:05:00.000Z",
    }),
    /URL HTTPS/u,
  );
  assert.deepEqual(baseline.state, snapshot);
});

test("rejette à checkedAt égal un échec dont le message diffère", () => {
  const checkedAt = "2026-08-30T11:00:00.000Z";
  const first = planTransition({
    state: emptyState(),
    successes: [],
    failures: [failure(tourism, checkedAt, "délai dépassé")],
    now: checkedAt,
  });
  const snapshot = structuredClone(first.state);

  assert.throws(
    () => planTransition({
      state: first.state,
      successes: [],
      failures: [failure(tourism, checkedAt, "signature absente")],
      now: "2026-08-30T11:05:00.000Z",
    }),
    /Résultat contradictoire.*tourism/u,
  );
  assert.deepEqual(first.state, snapshot);
});

test("refuse explicitement un ancien sourceState sans fingerprint", () => {
  const checkedAt = "2026-08-30T10:00:00.000Z";
  const current = planTransition({
    state: emptyState(),
    successes: [success(hydrophone, [event()], checkedAt)],
    failures: [],
    now: checkedAt,
  }).state;
  const legacy = structuredClone(current);
  delete legacy.sources.hydrophone.lastResultFingerprint;

  assert.throws(() => validateState(legacy), /État invalide/u);
  assert.notDeepEqual(validateState(undefined), legacy);
});

test("rejette un résultat égal contradictoire et un succès périmé après incident", () => {
  const firstAt = "2026-08-30T11:00:00.000Z";
  const oneFailure = planTransition({
    state: emptyState(),
    successes: [],
    failures: [failure(tourism, firstAt)],
    now: firstAt,
  });
  const oneFailureSnapshot = structuredClone(oneFailure.state);

  assert.throws(
    () => planTransition({
      state: oneFailure.state,
      successes: [success(tourism, [], firstAt)],
      failures: [],
      now: "2026-08-30T11:05:00.000Z",
    }),
    /Résultat contradictoire.*tourism/u,
  );
  assert.deepEqual(oneFailure.state, oneFailureSnapshot);

  let incidentState = oneFailure.state;
  for (const checkedAt of [
    "2026-08-30T12:00:00.000Z",
    "2026-08-30T13:00:00.000Z",
    "2026-08-30T14:00:00.000Z",
  ]) {
    incidentState = planTransition({
      state: incidentState,
      successes: [],
      failures: [failure(tourism, checkedAt)],
      now: checkedAt,
    }).state;
  }
  const incidentSnapshot = structuredClone(incidentState);

  assert.throws(
    () => planTransition({
      state: incidentState,
      successes: [success(tourism, [], "2026-08-30T13:30:00.000Z")],
      failures: [],
      now: "2026-08-30T14:05:00.000Z",
    }),
    /Résultat périmé.*tourism/u,
  );
  assert.deepEqual(incidentState, incidentSnapshot);
  assert.equal(incidentState.sources.tourism.incidentOpen, true);
});

test("le replay du quatrième échec n'émet pas une seconde alerte et ne change pas l'état", () => {
  let state = emptyState();
  let fourth;
  for (const checkedAt of [
    "2026-08-30T11:00:00.000Z",
    "2026-08-30T12:00:00.000Z",
    "2026-08-30T13:00:00.000Z",
    "2026-08-30T14:00:00.000Z",
  ]) {
    fourth = planTransition({
      state,
      successes: [],
      failures: [failure(tourism, checkedAt)],
      now: checkedAt,
    });
    state = fourth.state;
  }
  assert.equal(fourth.incidents.length, 1);
  const snapshot = structuredClone(state);

  const replay = planTransition({
    state,
    successes: [],
    failures: [failure(tourism, "2026-08-30T14:00:00.000Z")],
    now: "2026-08-30T14:05:00.000Z",
  });

  assert.deepEqual(replay.incidents, []);
  assert.deepEqual(replay.state, snapshot);
});

test("un cache candidat ancien ou égal ne remplace jamais une résolution fraîche", () => {
  const detailUrl = "https://www.lorientbretagnesudtourisme.fr/fr/fiche/cache-monotone/";
  const cachedEvent = createEvent({
    title: "Cache frais",
    startsOn: "2026-10-21",
    startsAt: null,
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://billetterie.hydrophone.fr/cache-frais",
    sourceUrl: detailUrl,
    sourceId: "tourism",
  });
  const freshRecord = {
    checkedAt: "2026-08-30T12:00:00.000Z",
    event: cachedEvent,
  };
  const fresh = planTransition({
    state: emptyState(),
    successes: [],
    failures: [],
    candidateUpdates: { [detailUrl]: freshRecord },
    now: freshRecord.checkedAt,
  });
  const snapshot = structuredClone(fresh.state);

  const stale = planTransition({
    state: fresh.state,
    successes: [],
    failures: [],
    candidateUpdates: {
      [detailUrl]: { checkedAt: "2026-08-30T11:00:00.000Z", event: null },
    },
    now: "2026-08-30T12:05:00.000Z",
  });
  assert.deepEqual(stale.state, snapshot);

  const equalReplay = planTransition({
    state: stale.state,
    successes: [],
    failures: [],
    candidateUpdates: { [detailUrl]: structuredClone(freshRecord) },
    now: "2026-08-30T12:10:00.000Z",
  });
  assert.deepEqual(equalReplay.state, snapshot);

  assert.throws(
    () => planTransition({
      state: equalReplay.state,
      successes: [],
      failures: [],
      candidateUpdates: {
        [detailUrl]: { checkedAt: freshRecord.checkedAt, event: null },
      },
      now: "2026-08-30T12:15:00.000Z",
    }),
    /Cache candidat contradictoire/u,
  );
  assert.deepEqual(fresh.state, snapshot);
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
  const { lastResultFingerprint, ...sourceState } = failed.state.sources.tourism;
  assert.match(lastResultFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(sourceState, {
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
