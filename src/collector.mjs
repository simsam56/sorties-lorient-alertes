import { parseMapado } from "./adapters/mapado.mjs";
import { parseTheatreLorient } from "./adapters/theatre-lorient.mjs";
import { parseHydrophone } from "./adapters/hydrophone.mjs";
import { parseTrios } from "./adapters/trios.mjs";
import { parseFil } from "./adapters/fil.mjs";
import { parseTourismCandidates } from "./adapters/tourism.mjs";
import { parseLorientEventsCandidates } from "./adapters/lorient-events.mjs";
import { resolveReservation as resolveOfficialReservation } from "./adapters/reservation-links.mjs";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const DETAIL_CONCURRENCY = 5;
const defaultTimeoutSignalFactory = (milliseconds) => AbortSignal.timeout(milliseconds);

export const DIRECT_ADAPTERS = Object.freeze({
  mapado: parseMapado,
  "theatre-lorient": parseTheatreLorient,
  hydrophone: parseHydrophone,
  trios: parseTrios,
  fil: parseFil,
});

const TERRITORIAL_PARSERS = Object.freeze({
  tourism: parseTourismCandidates,
  "lorient-events": parseLorientEventsCandidates,
});

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stateEntry(state, key) {
  if (state instanceof Map) return state.get(key);
  return state?.[key];
}

function checkedAtFrom(entry) {
  return typeof entry === "string" ? entry : entry?.checkedAt;
}

function isDue(source, sourceState, now) {
  const lastChecked = asDate(checkedAtFrom(stateEntry(sourceState, source.id)));
  if (!lastChecked) return true;
  return now.getTime() - lastChecked.getTime() >= source.pollEveryMinutes * 60 * 1000;
}

function timeoutOptions(timeoutSignalFactory) {
  return { signal: timeoutSignalFactory(FETCH_TIMEOUT_MS) };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cacheRecord(candidateState, detailUrl, now) {
  const record = stateEntry(candidateState, detailUrl);
  if (!record || typeof record !== "object" || !Object.hasOwn(record, "event")) return undefined;
  const checkedAt = asDate(record?.checkedAt);
  if (!checkedAt || now.getTime() < checkedAt.getTime() ||
      now.getTime() - checkedAt.getTime() >= SIX_HOURS_MS ||
      (record.event !== null && typeof record.event !== "object")) {
    return undefined;
  }
  return record.event;
}

function createLimiter(limit) {
  let active = 0;
  const pending = [];

  const runNext = () => {
    while (active < limit && pending.length > 0) {
      const { task, resolve, reject } = pending.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        runNext();
      });
    }
  };

  return (task) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    runNext();
  });
}

async function mapSettledWithLimit(items, runWithLimit, mapper) {
  return Promise.all(items.map(async (item) => {
    try {
      return { status: "fulfilled", value: await runWithLimit(() => mapper(item)) };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  }));
}

async function collectTerritorialSource({
  source,
  fetchText,
  checkedAt,
  candidateState,
  candidateUpdates,
  candidateParsers,
  resolveReservation,
  runDetail,
  timeoutSignalFactory,
}) {
  const listHtml = await fetchText(source.url, timeoutOptions(timeoutSignalFactory));
  const candidates = candidateParsers[source.adapter](listHtml, source);
  const cachedEvents = [];
  const candidatesToResolve = [];

  for (const candidate of candidates) {
    const cached = cacheRecord(candidateState, candidate.detailUrl, new Date(checkedAt));
    if (cached !== undefined) {
      if (cached) cachedEvents.push(cached);
      continue;
    }
    candidatesToResolve.push(candidate);
  }

  const detailResults = await mapSettledWithLimit(candidatesToResolve, runDetail, async (candidate) => {
    const detailHtml = await fetchText(candidate.detailUrl, timeoutOptions(timeoutSignalFactory));
    const event = resolveReservation(detailHtml, candidate);
    candidateUpdates[candidate.detailUrl] = { checkedAt, event };
    return event;
  });
  const failure = detailResults.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;

  return [...cachedEvents, ...detailResults.map((result) => result.value).filter(Boolean)];
}

async function collectOneSource({
  source,
  fetchText,
  checkedAt,
  candidateState,
  candidateUpdates,
  adapters,
  candidateParsers,
  resolveReservation,
  runDetail,
  timeoutSignalFactory,
}) {
  if (candidateParsers[source.adapter]) {
    return collectTerritorialSource({
      source,
      fetchText,
      checkedAt,
      candidateState,
      candidateUpdates,
      candidateParsers,
      resolveReservation,
      runDetail,
      timeoutSignalFactory,
    });
  }

  const adapter = adapters[source.adapter];
  if (!adapter) throw new Error(`Adaptateur absent: ${source.adapter}`);
  const html = await fetchText(source.url, timeoutOptions(timeoutSignalFactory));
  return adapter(html, source);
}

/**
 * Collecte les sources échues sans persister d'état. candidateState et
 * candidateUpdates sont volontairement des valeurs en mémoire, à fusionner par
 * l'appelant dans son propre stockage durable.
 */
export async function collectDueSources({
  sources,
  sourceState = {},
  candidateState = {},
  fetchText,
  now = new Date(),
  adapters = DIRECT_ADAPTERS,
  candidateParsers = TERRITORIAL_PARSERS,
  resolveReservation = resolveOfficialReservation,
  timeoutSignalFactory = defaultTimeoutSignalFactory,
}) {
  const checkedNow = asDate(now);
  if (!checkedNow) throw new Error("Date de collecte invalide");
  if (typeof fetchText !== "function") throw new Error("fetchText est requis");

  const checkedAt = checkedNow.toISOString();
  const candidateUpdates = {};
  const successes = [];
  const failures = [];
  const skipped = [];
  const dueSources = [];
  const runDetail = createLimiter(DETAIL_CONCURRENCY);

  for (const source of sources ?? []) {
    if (source.enabled !== true) {
      skipped.push({ source, reason: "disabled" });
    } else if (!isDue(source, sourceState, checkedNow)) {
      skipped.push({ source, reason: "not-due" });
    } else {
      dueSources.push(source);
    }
  }

  const settled = await Promise.allSettled(dueSources.map(async (source) => ({
    source,
    events: await collectOneSource({
      source,
      fetchText,
      checkedAt,
      candidateState,
      candidateUpdates,
      adapters,
      candidateParsers,
      resolveReservation,
      runDetail,
      timeoutSignalFactory,
    }),
  })));

  settled.forEach((result, index) => {
    const source = dueSources[index];
    if (result.status === "fulfilled") {
      successes.push({ source, events: result.value.events, checkedAt });
    } else {
      failures.push({ source, message: errorMessage(result.reason), checkedAt });
    }
  });

  return { successes, failures, skipped, candidateUpdates };
}

export const collectSources = collectDueSources;
