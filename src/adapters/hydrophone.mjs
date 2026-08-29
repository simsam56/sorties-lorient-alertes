import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

const HYDROPHONE_HOST = "www.hydrophone.fr";
const TICKETING_HOST = "billetterie.hydrophone.fr";
const NAVIGATION_FILES = new Set([
  "agenda.html",
  "programmation.html",
  "accessibilite.html",
  "a-propos.html",
  "espace-pro.html",
  "magazine.html",
  "studios.html",
  "missions.html",
  "pratique.html",
]);

function invalid(source) {
  throw new Error(`${source.name}: signature officielle absente`);
}

function hasOfficialSource(source) {
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && url.hostname === HYDROPHONE_HOST && url.pathname.endsWith(".html");
  } catch {
    return false;
  }
}

function noSaleAnnounced($) {
  return /aucun (?:concert|spectacle|événement)|aucune (?:vente|programmation)|pas de concert/iu.test($("body").text());
}

function programmeUrl($, element, source) {
  let url;
  try {
    url = new URL($(element).attr("href"), source.url);
  } catch {
    return null;
  }
  const filename = url.pathname.split("/").at(-1) ?? "";
  return url.protocol === "https:" && url.hostname === HYDROPHONE_HOST &&
    filename.endsWith(".html") && !filename.startsWith("-") &&
    !NAVIGATION_FILES.has(filename.toLowerCase()) ? url : null;
}

function placeParts(text) {
  const match = text.trim().match(/^(.*?)(?:\s*,\s*|\s+[–—-]\s+)([^,]+)$/u);
  return match ? { venue: match[1].trim(), city: match[2].trim() } : null;
}

function ticketUrl($, card) {
  for (const link of card.find("a[href]").toArray()) {
    let url;
    try {
      url = new URL($(link).attr("href"), `https://${HYDROPHONE_HOST}`);
    } catch {
      continue;
    }
    if (url.protocol === "https:" && url.hostname === TICKETING_HOST && url.pathname !== "/") return url.href;
  }
  return null;
}

function isFuture(startsOn) {
  return startsOn > new Date().toISOString().slice(0, 10);
}

export function parseHydrophone(html, source) {
  if (!hasOfficialSource(source)) invalid(source);
  const $ = load(html);
  const details = $("a[href]").toArray().map((element) => ({
    element,
    url: programmeUrl($, element, source),
  })).filter((detail) => detail.url);
  if (details.length === 0) {
    if ($("h1, h2").filter((_, heading) => /agenda|programmation/iu.test($(heading).text())).length && noSaleAnnounced($)) return [];
    invalid(source);
  }

  const events = new Map();
  for (const { element, url } of details) {
    const card = $(element).closest("article, .agenda-item, [data-event], .event-card").first();
    if (!card.length) continue;
    const title = card.find("h1, h2, h3").first().text().trim();
    const startsOn = parseFrenchDate(card.text());
    const place = placeParts(card.find(".place, .venue, .lieu, [class*='place'], [class*='venue'], [class*='lieu']").first().text());
    const bookingUrl = ticketUrl($, card);
    const venue = place?.venue ?? source.venue;
    const city = place?.city ?? source.city;
    if (!title || !startsOn || !venue || !city || !bookingUrl) continue;
    const event = createEvent({
      title,
      startsOn,
      startsAt: null,
      venue,
      city,
      bookingUrl,
      sourceUrl: url.href,
      sourceId: source.id,
    });
    events.set(`${event.title}\u0000${event.startsOn}\u0000${event.venue}`, event);
  }
  if (events.size === 0) invalid(source);
  return [...events.values()].filter((event) => isFuture(event.startsOn));
}
