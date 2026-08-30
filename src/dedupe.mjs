import { canonicalEventId, canonicalVenueId, normalizeText } from "./model.mjs";

const OFFICIAL_VENUE_DOMAINS = new Set([
  "theatredelorient.fr",
  "hydrophone.fr",
  "trio-s.fr",
]);
const TERRITORIAL_DOMAINS = new Set([
  "lorientbretagnesudtourisme.fr",
  "lorient-evenements.bzh",
]);
const ORGANIZER_WORDS = new Set([
  "association", "centre", "collectif", "culture", "festival", "mairie",
  "production", "productions", "salle", "theatre", "ville",
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

function titleWithoutOrganizerPrefix(title) {
  const source = String(title).trim();
  const match = source.match(/^(.{1,80}?)\s+pr[ée]sente(?:\s*[:\-–—]\s*|\s+)(.+)$/iu);
  if (!match) return source;
  const organizer = normalizeText(match[1]).split("-");
  return organizer.some((word) => ORGANIZER_WORDS.has(word)) ? match[2].trim() : source;
}

function titleTokens(title) {
  const withoutOrganizer = titleWithoutOrganizerPrefix(title)
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
    canonicalVenueId(left.venue) === canonicalVenueId(right.venue) &&
    (!isPresent(left.startsAt) || !isPresent(right.startsAt) || left.startsAt === right.startsAt) &&
    titleSimilarity(left.title, right.title) >= 0.85;
}

function dataPrecision(event) {
  return Object.values(event).filter((value) => value !== null && value !== undefined && value !== "").length;
}

function stableEventKey(event) {
  return Object.entries(event)
    .sort(([left], [right]) => left.localeCompare(right, "fr"))
    .map(([key, value]) => `${key}\u0000${JSON.stringify(value)}`)
    .join("\u0001");
}

function compareEvents(left, right) {
  return bookingPriority(left) - bookingPriority(right) ||
    dataPrecision(right) - dataPrecision(left) ||
    canonicalEventId(left).localeCompare(canonicalEventId(right), "fr") ||
    left.sourceId.localeCompare(right.sourceId, "fr") ||
    left.sourceUrl.localeCompare(right.sourceUrl, "fr") ||
    stableEventKey(left).localeCompare(stableEventKey(right), "fr");
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
  merged.title = titleWithoutOrganizerPrefix(merged.title);
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
