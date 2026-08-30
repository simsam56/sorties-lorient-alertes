import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

const MAPADO_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function invalidDatedEvent(source, index, field) {
  throw new Error(`${source.name}: structure Mapado invalide (dated_events[${index}].${field})`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function bookingUrlForSlug(source, index, slug) {
  let sourceUrl;
  let bookingUrl;
  const pathname = `/event/${slug}`;
  try {
    sourceUrl = new URL(source.url);
    bookingUrl = new URL(pathname, sourceUrl);
  } catch {
    invalidDatedEvent(source, index, "slug");
  }
  if (bookingUrl.origin !== sourceUrl.origin || bookingUrl.pathname !== pathname ||
      bookingUrl.search !== "" || bookingUrl.hash !== "") {
    invalidDatedEvent(source, index, "slug");
  }
  return bookingUrl.href;
}

function validateDatedEvent(item, source, index) {
  if (!isNonEmptyString(item.availabilityStatus)) {
    invalidDatedEvent(source, index, "availabilityStatus");
  }
  if (typeof item.isOnSale !== "boolean") invalidDatedEvent(source, index, "isOnSale");
  if (!isNonEmptyString(item.title)) invalidDatedEvent(source, index, "title");
  if (!isNonEmptyString(item.slug) || !MAPADO_SLUG_PATTERN.test(item.slug)) {
    invalidDatedEvent(source, index, "slug");
  }

  if (!item.isOnSale || item.availabilityStatus !== "onSale") return null;
  const schedule = item.sellingDeviceSchedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule) ||
      Object.keys(schedule).length === 0) {
    invalidDatedEvent(source, index, "sellingDeviceSchedule");
  }
  const entries = Object.values(schedule);
  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    invalidDatedEvent(source, index, "sellingDeviceSchedule");
  }
  const labels = entries
    .map((entry) => entry.fr)
    .filter((label) => label !== undefined);
  if (labels.some((label) => !isNonEmptyString(label))) {
    invalidDatedEvent(source, index, "sellingDeviceSchedule.fr");
  }
  const startsOn = labels.map(parseFrenchDate).find(Boolean);
  if (!startsOn) invalidDatedEvent(source, index, "sellingDeviceSchedule.date");
  return startsOn;
}

export function parseMapado(html, source) {
  const $ = load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) throw new Error(`${source.name}: signature Mapado absente`);

  const data = JSON.parse(raw);
  const items = data?.props?.pageProps?.entities?.ticketings?.["hydra:member"];
  if (!Array.isArray(items)) throw new Error(`${source.name}: collection Mapado absente`);
  if (items.some((item) => !item || typeof item !== "object")) {
    throw new Error(`${source.name}: structure Mapado invalide`);
  }

  return items.flatMap((item, index) => {
    if (item.type !== "dated_events") return [];
    const startsOn = validateDatedEvent(item, source, index);
    if (!startsOn) return [];
    const bookingUrl = bookingUrlForSlug(source, index, item.slug);
    return [createEvent({
      title: item.title,
      startsOn,
      startsAt: null,
      venue: item.venue?.name ?? source.venue,
      city: item.venue?.city ?? source.city,
      bookingUrl,
      sourceUrl: source.url,
      sourceId: source.id,
    })];
  });
}
