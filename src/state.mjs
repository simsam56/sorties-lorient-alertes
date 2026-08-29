import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { canonicalEventId } from "./model.mjs";
import { SOURCES } from "./sources.mjs";

const STATE_KEYS = ["version", "initializedAt", "updatedAt", "seen", "sources", "candidates"];
const SOURCE_KEYS = [
  "initializedAt",
  "lastSuccessAt",
  "lastCheckedAt",
  "consecutiveFailures",
  "incidentOpen",
  "lastResultFingerprint",
];
const SEEN_KEYS = ["title", "startsOn", "venue", "city", "bookingUrl", "notifiedAt", "sourceIds"];
const CANDIDATE_KEYS = ["checkedAt", "event"];
const EVENT_KEYS = [
  "title",
  "startsOn",
  "startsAt",
  "venue",
  "city",
  "bookingUrl",
  "sourceUrl",
  "sourceId",
];
const SOURCE_IDS = new Set(SOURCES.map(({ id }) => id));
const TERRITORIAL_HOSTS = new Map(
  SOURCES
    .filter(({ adapter }) => adapter === "tourism" || adapter === "lorient-events")
    .map((source) => [new URL(source.url).hostname.replace(/^www\./u, ""), source.id]),
);

function fail(reason) {
  throw new Error(`État invalide: ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} doit être un objet`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} possède des champs inattendus ou manquants`);
  }
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function assertNullableTimestamp(value, label) {
  if (value !== null && !isIsoTimestamp(value)) fail(`${label} doit être un horodatage ISO`);
}

function timestamp(value) {
  return value === null ? null : new Date(value).getTime();
}

function assertHttpsUrl(value, label) {
  try {
    if (typeof value !== "string" || new URL(value).protocol !== "https:") throw new Error();
  } catch {
    fail(`${label} doit être une URL HTTPS`);
  }
}

function assertText(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} doit être un texte non vide`);
}

function assertDate(value, label) {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${label} doit être une date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} doit être une date réelle`);
  }
}

function assertKnownSourceIds(sourceIds, label) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0 ||
      sourceIds.some((id) => typeof id !== "string" || !SOURCE_IDS.has(id)) ||
      new Set(sourceIds).size !== sourceIds.length) {
    fail(`${label} contient un identifiant de source inconnu ou dupliqué`);
  }
}

function assertSourceRecord(record, id, stateUpdatedAt) {
  assertExactKeys(record, SOURCE_KEYS, `source ${id}`);
  assertNullableTimestamp(record.initializedAt, `source ${id}.initializedAt`);
  assertNullableTimestamp(record.lastSuccessAt, `source ${id}.lastSuccessAt`);
  if (!isIsoTimestamp(record.lastCheckedAt)) fail(`source ${id}.lastCheckedAt doit être un horodatage ISO`);
  if (!Number.isInteger(record.consecutiveFailures) || record.consecutiveFailures < 0) {
    fail(`source ${id}.consecutiveFailures doit être un entier positif`);
  }
  if (typeof record.incidentOpen !== "boolean") fail(`source ${id}.incidentOpen doit être booléen`);
  if (typeof record.lastResultFingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(record.lastResultFingerprint)) {
    fail(`source ${id}.lastResultFingerprint est absent ou invalide`);
  }
  if ((record.initializedAt === null) !== (record.lastSuccessAt === null)) {
    fail(`source ${id} a une initialisation incohérente`);
  }
  if (record.initializedAt !== null && timestamp(record.initializedAt) > timestamp(record.lastSuccessAt)) {
    fail(`source ${id} réussit avant son initialisation`);
  }
  if (record.lastSuccessAt !== null && timestamp(record.lastSuccessAt) > timestamp(record.lastCheckedAt)) {
    fail(`source ${id} a une réussite postérieure au contrôle`);
  }
  if (record.consecutiveFailures === 0 && record.lastSuccessAt !== record.lastCheckedAt) {
    fail(`source ${id} sans échec doit finir par une réussite`);
  }
  if (record.consecutiveFailures > 0 && record.lastSuccessAt === record.lastCheckedAt) {
    fail(`source ${id} en échec ne peut pas finir par une réussite`);
  }
  if (record.incidentOpen !== (record.consecutiveFailures >= 4)) {
    fail(`source ${id} a un cycle d'incident incohérent`);
  }
  if (stateUpdatedAt === null || timestamp(record.lastCheckedAt) > timestamp(stateUpdatedAt)) {
    fail(`source ${id} est postérieure à l'état`);
  }
}

function assertSeenRecord(record, id, stateUpdatedAt) {
  assertExactKeys(record, SEEN_KEYS, `événement ${id}`);
  assertText(record.title, `événement ${id}.title`);
  assertDate(record.startsOn, `événement ${id}.startsOn`);
  assertText(record.venue, `événement ${id}.venue`);
  assertText(record.city, `événement ${id}.city`);
  assertHttpsUrl(record.bookingUrl, `événement ${id}.bookingUrl`);
  assertNullableTimestamp(record.notifiedAt, `événement ${id}.notifiedAt`);
  assertKnownSourceIds(record.sourceIds, `événement ${id}.sourceIds`);
  if (record.notifiedAt !== null &&
      (stateUpdatedAt === null || timestamp(record.notifiedAt) > timestamp(stateUpdatedAt))) {
    fail(`événement ${id}.notifiedAt est postérieur à l'état`);
  }
  if (canonicalEventId(record) !== id) fail(`identifiant canonique incohérent: ${id}`);
}

function territorialSourceId(url, label) {
  assertHttpsUrl(url, label);
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  for (const [domain, sourceId] of TERRITORIAL_HOSTS) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return sourceId;
  }
  fail(`${label} pointe hors des sources territoriales`);
}

function assertCandidateEvent(value, detailUrl, expectedSourceId) {
  assertExactKeys(value, EVENT_KEYS, `candidat ${detailUrl}.event`);
  assertText(value.title, `candidat ${detailUrl}.event.title`);
  assertDate(value.startsOn, `candidat ${detailUrl}.event.startsOn`);
  if (value.startsAt !== null &&
      (typeof value.startsAt !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value.startsAt))) {
    fail(`candidat ${detailUrl}.event.startsAt est invalide`);
  }
  assertText(value.venue, `candidat ${detailUrl}.event.venue`);
  assertText(value.city, `candidat ${detailUrl}.event.city`);
  assertHttpsUrl(value.bookingUrl, `candidat ${detailUrl}.event.bookingUrl`);
  assertHttpsUrl(value.sourceUrl, `candidat ${detailUrl}.event.sourceUrl`);
  if (value.sourceUrl !== detailUrl || value.sourceId !== expectedSourceId) {
    fail(`candidat ${detailUrl}.event ne correspond pas à sa source`);
  }
}

function assertCandidateRecord(record, detailUrl, stateUpdatedAt) {
  assertExactKeys(record, CANDIDATE_KEYS, `candidat ${detailUrl}`);
  const sourceId = territorialSourceId(detailUrl, `candidat ${detailUrl}`);
  if (!isIsoTimestamp(record.checkedAt)) fail(`candidat ${detailUrl}.checkedAt doit être un horodatage ISO`);
  if (stateUpdatedAt === null || timestamp(record.checkedAt) > timestamp(stateUpdatedAt)) {
    fail(`candidat ${detailUrl} est postérieur à l'état`);
  }
  if (record.event !== null) assertCandidateEvent(record.event, detailUrl, sourceId);
}

export function emptyState() {
  return {
    version: 1,
    initializedAt: null,
    updatedAt: null,
    seen: {},
    sources: {},
    candidates: {},
  };
}

/**
 * L'absence de fichier est représentée par undefined et produit un état neuf.
 * Toute valeur présente, y compris null ou un objet partiel, doit être valide.
 */
export function validateState(value) {
  if (value === undefined) return emptyState();
  assertExactKeys(value, STATE_KEYS, "racine");
  if (value.version !== 1) fail(`version ${String(value.version)} non prise en charge`);
  assertNullableTimestamp(value.initializedAt, "initializedAt");
  assertNullableTimestamp(value.updatedAt, "updatedAt");
  if ((value.initializedAt === null) !== (value.updatedAt === null)) {
    fail("initializedAt et updatedAt sont incohérents");
  }
  if (value.initializedAt !== null && timestamp(value.initializedAt) > timestamp(value.updatedAt)) {
    fail("initializedAt est postérieur à updatedAt");
  }
  if (!isRecord(value.seen) || !isRecord(value.sources) || !isRecord(value.candidates)) {
    fail("seen, sources et candidates doivent être des objets");
  }

  for (const [id, record] of Object.entries(value.sources)) {
    if (!SOURCE_IDS.has(id)) fail(`source inconnue: ${id}`);
    assertSourceRecord(record, id, value.updatedAt);
  }
  for (const [id, record] of Object.entries(value.seen)) {
    assertSeenRecord(record, id, value.updatedAt);
  }
  for (const [detailUrl, record] of Object.entries(value.candidates)) {
    assertCandidateRecord(record, detailUrl, value.updatedAt);
  }

  if (value.initializedAt === null &&
      (Object.keys(value.seen).length > 0 || Object.keys(value.sources).length > 0 ||
       Object.keys(value.candidates).length > 0)) {
    fail("un état non initialisé doit être vide");
  }
  return value;
}

function assertTransitionTimestamp(value, label, nowMs) {
  if (!isIsoTimestamp(value)) throw new Error(`${label} invalide`);
  if (timestamp(value) > nowMs) throw new Error(`${label} postérieur à now`);
}

function assertCollectionEntry(entry, kind, nowMs) {
  if (!isRecord(entry) || !isRecord(entry.source) || !SOURCE_IDS.has(entry.source.id)) {
    throw new Error(`${kind} de source invalide`);
  }
  assertTransitionTimestamp(entry.checkedAt, `${kind}.checkedAt`, nowMs);
  if (kind === "réussite" && !Array.isArray(entry.events)) throw new Error("réussite.events invalide");
  if (kind === "échec" && (typeof entry.message !== "string" || entry.message.trim() === "")) {
    throw new Error("échec.message invalide");
  }
}

function observedSourceIds(observed, sourceId) {
  const ids = observed.sourceIds ?? (observed.sourceId ? [observed.sourceId] : [sourceId]);
  assertKnownSourceIds(ids, "événement observé.sourceIds");
  if (!ids.includes(sourceId)) fail(`événement observé absent de sa source ${sourceId}`);
  if (observed.sourceId !== undefined && !ids.includes(observed.sourceId)) {
    fail("événement observé.sourceId est absent de sourceIds");
  }
  return [...ids].sort();
}

function seenRecord(observed, sourceIds, notifiedAt) {
  return {
    title: observed.title,
    startsOn: observed.startsOn,
    venue: observed.venue,
    city: observed.city,
    bookingUrl: observed.bookingUrl,
    notifiedAt,
    sourceIds,
  };
}

function observedSourceUrls(observed) {
  const urls = observed.sourceUrls ?? (observed.sourceUrl ? [observed.sourceUrl] : []);
  if (!Array.isArray(urls) || urls.length === 0) {
    fail("événement observé.sourceUrls est absent");
  }
  for (const url of urls) assertHttpsUrl(url, "événement observé.sourceUrls");
  const normalized = urls.map((url) => new URL(url).href);
  if (observed.sourceUrl !== undefined && !normalized.includes(new URL(observed.sourceUrl).href)) {
    fail("événement observé.sourceUrl est absent de sa provenance");
  }
  return [...new Set(normalized)].sort();
}

function validateObservedEvent(observed, sourceId) {
  if (!isRecord(observed)) fail("événement observé invalide");
  assertText(observed.title, "événement observé.title");
  assertDate(observed.startsOn, "événement observé.startsOn");
  if (observed.startsAt !== null && observed.startsAt !== undefined &&
      (typeof observed.startsAt !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(observed.startsAt))) {
    fail("événement observé.startsAt est invalide");
  }
  assertText(observed.venue, "événement observé.venue");
  assertText(observed.city, "événement observé.city");
  assertHttpsUrl(observed.bookingUrl, "événement observé.bookingUrl");
  if (!SOURCE_IDS.has(observed.sourceId)) {
    fail("événement observé.sourceId est inconnu");
  }
  assertHttpsUrl(observed.sourceUrl, "événement observé.sourceUrl");

  const sourceIds = observedSourceIds(observed, sourceId);
  const sourceUrls = observedSourceUrls(observed);
  return {
    observed,
    sourceIds,
    sourceUrls,
    fingerprintValue: {
      id: canonicalEventId(observed),
      title: observed.title.trim(),
      startsOn: observed.startsOn,
      startsAt: observed.startsAt ?? null,
      venue: observed.venue.trim(),
      city: observed.city.trim(),
      bookingUrl: new URL(observed.bookingUrl).href,
      sourceId: observed.sourceId,
      sourceUrl: new URL(observed.sourceUrl).href,
      sourceIds,
      sourceUrls,
    },
  };
}

function mergeCandidateUpdates(next, candidateUpdates, nowMs) {
  if (!isRecord(candidateUpdates)) throw new Error("candidateUpdates invalide");
  for (const [detailUrl, record] of Object.entries(candidateUpdates)) {
    const sourceId = territorialSourceId(detailUrl, `candidat ${detailUrl}`);
    assertExactKeys(record, CANDIDATE_KEYS, `candidat ${detailUrl}`);
    assertTransitionTimestamp(record.checkedAt, `candidat ${detailUrl}.checkedAt`, nowMs);
    if (record.event !== null) assertCandidateEvent(record.event, detailUrl, sourceId);
  }

  let changed = false;
  for (const [detailUrl, record] of Object.entries(candidateUpdates)) {
    const previous = next.candidates[detailUrl];
    if (previous) {
      const ordering = timestamp(record.checkedAt) - timestamp(previous.checkedAt);
      if (ordering < 0) continue;
      if (ordering === 0) {
        if (!isDeepStrictEqual(record, previous)) {
          throw new Error(`Cache candidat contradictoire à ${record.checkedAt}: ${detailUrl}`);
        }
        continue;
      }
    }
    next.candidates[detailUrl] = structuredClone(record);
    changed = true;
  }
  return changed;
}

function resultFingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function prepareSourceResult(entry, kind, nowMs) {
  assertCollectionEntry(entry, kind === "success" ? "réussite" : "échec", nowMs);
  if (kind === "failure") {
    return {
      entry,
      fingerprint: resultFingerprint({ kind, message: entry.message.trim() }),
      validatedEvents: [],
    };
  }

  const validatedEvents = entry.events.map((observed) => validateObservedEvent(observed, entry.source.id));
  const normalizedEvents = [...new Set(validatedEvents
    .map(({ fingerprintValue }) => JSON.stringify(fingerprintValue)))]
    .sort()
    .map((value) => JSON.parse(value));
  return {
    entry,
    fingerprint: resultFingerprint({ kind, events: normalizedEvents }),
    validatedEvents,
  };
}

function classifySourceResult(current, prepared) {
  const { entry, fingerprint } = prepared;
  const previous = current.sources[entry.source.id];
  if (!previous) return "fresh";

  const ordering = timestamp(entry.checkedAt) - timestamp(previous.lastCheckedAt);
  if (ordering < 0) {
    throw new Error(`Résultat périmé pour la source ${entry.source.id}: ${entry.checkedAt}`);
  }
  if (ordering > 0) return "fresh";

  if (previous.lastResultFingerprint !== fingerprint) {
    throw new Error(`Résultat contradictoire pour la source ${entry.source.id} à ${entry.checkedAt}`);
  }
  return "replay";
}

export function planTransition({
  state,
  successes = [],
  failures = [],
  candidateUpdates = {},
  now = new Date(),
}) {
  const current = validateState(state);
  const nowValue = now instanceof Date ? now.toISOString() : now;
  if (!isIsoTimestamp(nowValue)) throw new Error("now invalide");
  const nowMs = timestamp(nowValue);
  if (!Array.isArray(successes) || !Array.isArray(failures)) throw new Error("résultats de collecte invalides");

  const preparedSuccesses = successes.map((entry) => prepareSourceResult(entry, "success", nowMs));
  const preparedFailures = failures.map((entry) => prepareSourceResult(entry, "failure", nowMs));
  const resultIds = [...successes, ...failures].map(({ source }) => source.id);
  if (new Set(resultIds).size !== resultIds.length) throw new Error("une source possède plusieurs résultats");

  const next = structuredClone(current);
  const incidents = [];
  const recoveries = [];
  const initializedSources = [];
  const observations = new Map();
  let touched = false;

  const freshFailures = preparedFailures.filter((prepared) => classifySourceResult(current, prepared) === "fresh");
  const freshSuccesses = preparedSuccesses.filter((prepared) => classifySourceResult(current, prepared) === "fresh");
  touched ||= mergeCandidateUpdates(next, candidateUpdates, nowMs);

  for (const prepared of freshFailures) {
    const { entry, fingerprint } = prepared;
    touched = true;
    const previous = next.sources[entry.source.id] ?? {
      initializedAt: null,
      lastSuccessAt: null,
      lastCheckedAt: entry.checkedAt,
      consecutiveFailures: 0,
      incidentOpen: false,
      lastResultFingerprint: fingerprint,
    };
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const opensIncident = !previous.incidentOpen && consecutiveFailures === 4;
    next.sources[entry.source.id] = {
      ...previous,
      lastCheckedAt: entry.checkedAt,
      consecutiveFailures,
      incidentOpen: previous.incidentOpen || opensIncident,
      lastResultFingerprint: fingerprint,
    };
    if (opensIncident) incidents.push({ ...entry, consecutiveFailures });
  }

  for (const prepared of freshSuccesses) {
    const { entry, fingerprint, validatedEvents } = prepared;
    touched = true;
    const previous = next.sources[entry.source.id];
    const wasInitialized = previous?.initializedAt !== null && previous?.initializedAt !== undefined;
    if (previous?.incidentOpen) recoveries.push({ source: entry.source, checkedAt: entry.checkedAt });
    if (!wasInitialized) initializedSources.push(entry.source);
    next.sources[entry.source.id] = {
      initializedAt: previous?.initializedAt ?? entry.checkedAt,
      lastSuccessAt: entry.checkedAt,
      lastCheckedAt: entry.checkedAt,
      consecutiveFailures: 0,
      incidentOpen: false,
      lastResultFingerprint: fingerprint,
    };

    for (const { observed, sourceIds, sourceUrls } of validatedEvents) {
      const id = canonicalEventId(observed);
      const existing = observations.get(id);
      if (existing) {
        existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])]
          .sort((left, right) => left.localeCompare(right, "fr"));
        existing.sourceUrls = [...new Set([...existing.sourceUrls, ...sourceUrls])]
          .sort((left, right) => left.localeCompare(right, "fr"));
        existing.fromInitializedSource ||= wasInitialized;
      } else {
        observations.set(id, { observed, sourceIds, sourceUrls, fromInitializedSource: wasInitialized });
      }
    }
  }

  const newEvents = [];
  for (const [id, observation] of observations) {
    const prior = next.seen[id];
    if (prior) {
      prior.sourceIds = [...new Set([...prior.sourceIds, ...observation.sourceIds])]
        .sort((left, right) => left.localeCompare(right, "fr"));
    } else if (observation.fromInitializedSource) {
      newEvents.push({
        ...observation.observed,
        sourceIds: observation.sourceIds,
        sourceUrls: observation.sourceUrls,
      });
    } else {
      next.seen[id] = seenRecord(observation.observed, observation.sourceIds, null);
    }
  }

  if (touched) {
    next.initializedAt ??= nowValue;
    next.updatedAt = nowValue;
  }
  validateState(next);
  return { state: next, newEvents, incidents, recoveries, initializedSources };
}

export const applyCollection = planTransition;

export function acknowledgeNotifications(transition, successfulIds, now = new Date()) {
  if (!isRecord(transition) || !Array.isArray(transition.newEvents)) {
    throw new Error("Transition invalide");
  }
  const current = validateState(transition.state);
  const notifiedAt = now instanceof Date ? now.toISOString() : now;
  if (!isIsoTimestamp(notifiedAt) ||
      (current.updatedAt !== null && timestamp(notifiedAt) < timestamp(current.updatedAt))) {
    throw new Error("Date d'acquittement invalide");
  }
  if (!Array.isArray(successfulIds)) throw new Error("Identifiants acquittés invalides");

  const pending = new Map(transition.newEvents.map((observed) => [canonicalEventId(observed), observed]));
  const acknowledgedIds = new Set(successfulIds);
  for (const id of acknowledgedIds) {
    if (!pending.has(id)) throw new Error(`Acquittement inconnu: ${id}`);
  }

  const next = structuredClone(current);
  for (const id of acknowledgedIds) {
    const observed = pending.get(id);
    const sourceIds = observed.sourceIds ?? [observed.sourceId];
    next.seen[id] = seenRecord(observed, [...sourceIds], notifiedAt);
  }
  if (acknowledgedIds.size > 0) next.updatedAt = notifiedAt;
  validateState(next);
  return { ...transition, state: next };
}
