import { canonicalEventId } from "./model.mjs";

function fail(reason) {
  throw new Error(`État invalide: ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canComputeCanonicalId(record) {
  return isRecord(record)
    && typeof record.title === "string"
    && typeof record.startsOn === "string"
    && typeof record.venue === "string"
    && typeof record.city === "string";
}

function timestamp(value) {
  return value === null ? null : new Date(value).getTime();
}

function earliestTimestamp(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return timestamp(left) <= timestamp(right) ? left : right;
}

function mergeUniqueStrings(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort();
}

function migrateKeyedEvents(records, merge, conflictLabel) {
  const migrated = {};
  for (const [id, record] of Object.entries(records)) {
    const canonicalId = canComputeCanonicalId(record) ? canonicalEventId(record) : id;
    if (migrated[canonicalId]) {
      migrated[canonicalId] = merge(migrated[canonicalId], record);
      if (canonicalEventId(migrated[canonicalId]) !== canonicalId) {
        fail(`${conflictLabel}: ${canonicalId}`);
      }
    } else {
      migrated[canonicalId] = record;
    }
  }
  return migrated;
}

function mergeSeenForCanonicalId(left, right) {
  return {
    ...left,
    sourceIds: mergeUniqueStrings(left.sourceIds, right.sourceIds),
    notifiedAt: earliestTimestamp(left.notifiedAt ?? null, right.notifiedAt ?? null),
  };
}

function mergePendingForCanonicalId(left, right) {
  const sourceIds = mergeUniqueStrings(left.sourceIds, right.sourceIds);
  const sourceUrls = mergeUniqueStrings(left.sourceUrls, right.sourceUrls);
  return {
    ...left,
    sourceIds,
    sourceUrls,
    sourceId: sourceIds.includes(left.sourceId) ? left.sourceId : sourceIds[0],
    sourceUrl: sourceUrls.includes(left.sourceUrl) ? left.sourceUrl : sourceUrls[0],
  };
}

/**
 * Réécrit les clés seen / outbox.events vers l'identifiant canonique courant.
 * Les alias ajoutés après coup (code postal, salle) ne doivent jamais invalider
 * un état déjà persisté.
 */
export function migrateCanonicalEventKeys(value) {
  const seen = migrateKeyedEvents(value.seen, mergeSeenForCanonicalId, "identifiant canonique contradictoire");
  const events = migrateKeyedEvents(
    value.outbox.events,
    mergePendingForCanonicalId,
    "identifiant d'outbox contradictoire",
  );
  return {
    ...value,
    seen,
    outbox: {
      ...value.outbox,
      events: Object.fromEntries(Object.entries(events).filter(([id]) => !seen[id])),
    },
  };
}
