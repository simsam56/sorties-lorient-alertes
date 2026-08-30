const MONTHS = new Map([
  ["janv", 1], ["janvier", 1], ["févr", 2], ["fevrier", 2],
  ["février", 2], ["mars", 3], ["avr", 4], ["avril", 4],
  ["mai", 5], ["juin", 6], ["juil", 7], ["juillet", 7],
  ["août", 8], ["aout", 8], ["sept", 9], ["septembre", 9],
  ["oct", 10], ["octobre", 10], ["nov", 11], ["novembre", 11],
  ["déc", 12], ["dec", 12], ["décembre", 12], ["decembre", 12],
]);

const VENUE_ALIASES = new Map([
  ["grand-theatre", "theatre-de-lorient"],
  ["grand-theatre-de-lorient", "theatre-de-lorient"],
  ["salle-keragan", "oceanis"],
]);

export function normalizeText(value) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function canonicalVenueId(venue) {
  const normalized = normalizeText(venue);
  return VENUE_ALIASES.get(normalized) ?? normalized;
}

export function parseFrenchDate(text) {
  const match = text.toLowerCase().match(/(\d{1,2})\s+([a-zéû\.]+)\s+(20\d{2})/u);
  if (!match) return null;
  const month = MONTHS.get(match[2].replace(/\.$/, ""));
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function createEvent(input) {
  const event = {
    ...input,
    title: input.title?.trim(),
    venue: input.venue?.trim(),
    city: input.city?.trim(),
  };
  const urls = [event.bookingUrl, event.sourceUrl].every((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });
  if (!event.title || !/^20\d{2}-\d{2}-\d{2}$/.test(event.startsOn ?? "") ||
      !event.venue || !event.city || !event.sourceId || !urls) {
    throw new Error("Événement invalide");
  }
  return Object.freeze(event);
}

export function canonicalEventId(event) {
  return [
    event.startsOn,
    normalizeText(event.city),
    canonicalVenueId(event.venue),
    normalizeText(event.title),
  ].join(":");
}
