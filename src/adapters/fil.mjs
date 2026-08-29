import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

const FESTIVAL_HOST = "www.festival-interceltique.bzh";
const TICKETING_HOSTS = new Set(["reelax-tickets.com", "www.reelax-tickets.com"]);

function invalid(source) {
  throw new Error(`${source.name}: signature officielle absente`);
}

function hasOfficialSource(source) {
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && url.hostname === FESTIVAL_HOST && /^\/billetterie-20\d{2}\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function noSaleAnnounced($) {
  return /aucun (?:concert|spectacle|événement)|aucune (?:vente|programmation)|pas de spectacle/iu.test($("body").text());
}

function placeParts(text) {
  const match = text.trim().match(/^(.*?)(?:\s*,\s*|\s+[–—-]\s+)([^,]+)$/u);
  return match ? { venue: match[1].trim(), city: match[2].trim() } : null;
}

function ticketUrl($, card, source) {
  for (const link of card.find("a[href]").toArray()) {
    let url;
    try {
      url = new URL($(link).attr("href"), source.url);
    } catch {
      continue;
    }
    if (url.protocol === "https:" && TICKETING_HOSTS.has(url.hostname) && url.pathname !== "/") return url.href;
  }
  return null;
}

function isFuture(startsOn) {
  return startsOn > new Date().toISOString().slice(0, 10);
}

export function parseFil(html, source) {
  if (!hasOfficialSource(source)) invalid(source);
  const $ = load(html);
  const hasHeading = $("h1, h2").filter((_, heading) => /billetterie/iu.test($(heading).text())).length > 0;
  if (!hasHeading) invalid(source);
  const cards = $("article, [data-event], .event-card").toArray();
  if (cards.length === 0) {
    if (noSaleAnnounced($)) return [];
    invalid(source);
  }

  const events = new Map();
  for (const element of cards) {
    const card = $(element);
    const title = card.find("h1, h2, h3").first().text().trim();
    const startsOn = parseFrenchDate(card.text());
    const place = placeParts(card.find(".place, .venue, .lieu, [class*='place'], [class*='venue'], [class*='lieu']").first().text());
    const bookingUrl = ticketUrl($, card, source);
    if (!title || !startsOn || !place || !bookingUrl) continue;
    const event = createEvent({
      title,
      startsOn,
      startsAt: null,
      venue: place.venue,
      city: place.city,
      bookingUrl,
      sourceUrl: new URL(source.url).href,
      sourceId: source.id,
    });
    events.set(`${event.title}\u0000${event.startsOn}\u0000${event.venue}`, event);
  }
  if (events.size === 0) invalid(source);
  return [...events.values()].filter((event) => isFuture(event.startsOn));
}
