import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

const VOSTICKETS_HOSTS = new Set(["vostickets.net", "www.vostickets.net"]);

function invalid(source) {
  throw new Error(`${source.name}: signature officielle absente`);
}

function hasOfficialSource(source) {
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && VOSTICKETS_HOSTS.has(url.hostname) && url.pathname === "/billet" &&
      url.searchParams.get("id")?.toUpperCase() === "TRIO";
  } catch {
    return false;
  }
}

function noSaleAnnounced($) {
  return /aucun (?:concert|spectacle|événement)|aucune (?:vente|programmation)|pas de spectacle/iu.test($("body").text());
}

function isTrioLink($) {
  return $("a[href]").toArray().some((element) => {
    try {
      const url = new URL($(element).attr("href"), "https://trio-s.fr/");
      return url.protocol === "https:" && (url.hostname === "trio-s.fr" || url.hostname === "www.trio-s.fr");
    } catch {
      return false;
    }
  });
}

function productionCards($) {
  return $("img[src]").toArray().filter((image) => {
    try {
      const url = new URL($(image).attr("src"), "https://www.vostickets.net/");
      return /^\/public\/site\/902\/spectacle\/\d+\//u.test(url.pathname);
    } catch {
      return false;
    }
  }).map((image) => $(image).closest("article, .spectacle, .product, [data-event]").first()).filter((card) => card.length);
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
    if (url.protocol === "https:" && VOSTICKETS_HOSTS.has(url.hostname) && url.pathname === "/billet" &&
        url.searchParams.get("ID")?.toUpperCase() === "TRIO" && url.searchParams.has("SPC")) return url.href;
  }
  return null;
}

function isFuture(startsOn) {
  return startsOn > new Date().toISOString().slice(0, 10);
}

export function parseTrios(html, source) {
  if (!hasOfficialSource(source)) invalid(source);
  const $ = load(html);
  if (!isTrioLink($)) invalid(source);
  const cards = productionCards($);
  if (cards.length === 0) {
    if (noSaleAnnounced($)) return [];
    invalid(source);
  }

  const events = new Map();
  for (const card of cards) {
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
