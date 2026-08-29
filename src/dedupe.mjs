import { canonicalEventId, normalizeText } from "./model.mjs";

const VENUE_ALIASES = new Map([
  ["grand-theatre", "theatre-de-lorient"],
  ["grand-theatre-de-lorient", "theatre-de-lorient"],
  ["salle-keragan", "oceanis"],
]);

const OFFICIAL_VENUE_DOMAINS = new Set([
  "theatredelorient.fr",
  "hydrophone.fr",
  "trio-s.fr",
]);
const TERRITORIAL_DOMAINS = new Set([
  "lorientbretagnesudtourisme.fr",
  "lorient-evenements.bzh",
]);

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function isDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function bookingPriority(event) {
  const host = hostname(event.bookingUrl);
  if ([...OFFICIAL_VENUE_DOMAINS].some((domain) => isDomain(host, domain))) return 0;
  if (isDomain(host, "mapado.com") || isDomain(host, "vostickets.net")) return 1;
  if (isDomain(host, "reelax-tickets.com")) return 2;
  if ([...TERRITORIAL_DOMAINS].some((domain) => isDomain(host, domain))) return 3;
  return 4;
}

function canonicalVenue(venue) {
  const normalized = normalizeText(venue);
  return VENUE_ALIASES.get(normalized) ?? normalized;
}

function titleTokens(title) {
  const withoutOrganizer = String(title)
    .replace(/^[^:]{1,80}\s+pr[ée]sente\s*[:\-–—]\s*/iu, "")
    .replace(/[&+]/gu, " et ")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ");
  return new Set(withoutOrganizer.trim().split(/\s+/u).filter(Boolean));
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function sameIdentity(left, right) {
  return left.startsOn === right.startsOn &&
    normalizeText(left.city) === normalizeText(right.city) &&
    canonicalVenue(left.venue) === canonicalVenue(right.venue) &&
    titleSimilarity(left.title, right.title) >= 0.85;
}

function dataPrecision(event) {
  return Object.values(event).filter((value) => value !== null && value !== undefined && value !== "").length;
}

function compareEvents(left, right) {
  return bookingPriority(left) - bookingPriority(right) ||
    dataPrecision(right) - dataPrecision(left) ||
    canonicalEventId(left).localeCompare(canonicalEventId(right), "fr") ||
    left.sourceId.localeCompare(right.sourceId, "fr") ||
    left.sourceUrl.localeCompare(right.sourceUrl, "fr");
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== "";
}

function mergeGroup(group) {
  const ordered = [...group].sort(compareEvents);
  const preferred = ordered[0];
  const merged = { ...preferred };

  for (const event of ordered.slice(1)) {
    for (const [key, value] of Object.entries(event)) {
      if (key === "sourceId" || key === "sourceUrl" || key === "bookingUrl") continue;
      if (!isPresent(merged[key]) && isPresent(value)) merged[key] = value;
    }
  }

  merged.bookingUrl = ordered[0].bookingUrl;
  return Object.freeze({
    ...merged,
    sourceIds: Object.freeze([...new Set(ordered.map((event) => event.sourceId))].sort((a, b) => a.localeCompare(b, "fr"))),
    sourceUrls: Object.freeze([...new Set(ordered.map((event) => event.sourceUrl))].sort((a, b) => a.localeCompare(b, "fr"))),
  });
}

/**
 * Fusionne seulement les événements dont les quatre signaux d'identité sont
 * suffisamment concordants, sans modifier les entrées collectées.
 */
export function deduplicateEvents(events) {
  const groups = [];
  const ordered = [...events].sort(compareEvents);

  for (const event of ordered) {
    const matchingGroup = groups.find((group) => group.every((candidate) => sameIdentity(event, candidate)));
    if (matchingGroup) matchingGroup.push(event);
    else groups.push([event]);
  }

  return groups.map(mergeGroup).sort(compareEvents);
}
