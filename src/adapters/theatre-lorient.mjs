import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

const THEATRE_HOST = "theatredelorient.fr";
const TICKETING_HOST = "billetterie.theatredelorient.fr";

function invalid(source) {
  throw new Error(`${source.name}: signature officielle absente`);
}

function hasOfficialSource(source) {
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && url.hostname === THEATRE_HOST && /^\/saison\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function noSaleAnnounced($) {
  return /aucun (?:spectacle|événement)|aucune (?:vente|programmation)|pas de spectacle/iu.test($("body").text());
}

function eventCard($, element) {
  return $(element).closest("article, [data-event], .agenda-item, .event-card").first();
}

function ticketUrl($, card) {
  for (const link of card.find("a[href]").toArray()) {
    let url;
    try {
      url = new URL($(link).attr("href"), `https://${THEATRE_HOST}`);
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

export function parseTheatreLorient(html, source) {
  if (!hasOfficialSource(source)) invalid(source);
  const $ = load(html);
  const details = $("a[href]").toArray().filter((element) => {
    try {
      const url = new URL($(element).attr("href"), source.url);
      return url.protocol === "https:" && url.hostname === THEATRE_HOST && /^\/spectacle\/[^/]+\/?$/u.test(url.pathname);
    } catch {
      return false;
    }
  });
  if (details.length === 0) {
    if (noSaleAnnounced($)) return [];
    invalid(source);
  }

  const events = new Map();
  for (const detail of details) {
    const card = eventCard($, detail);
    if (!card.length) continue;
    const title = card.find("h1, h2, h3").first().text().trim();
    const startsOn = parseFrenchDate(card.text());
    const venue = card.find(".room, .salle, .lieu, [class*='room'], [class*='salle'], [class*='lieu']").first().text().trim();
    const bookingUrl = ticketUrl($, card);
    if (!title || !startsOn || !venue || !bookingUrl) continue;
    const sourceUrl = new URL($(detail).attr("href"), source.url).href;
    const event = createEvent({
      title,
      startsOn,
      startsAt: null,
      venue,
      city: source.city,
      bookingUrl,
      sourceUrl,
      sourceId: source.id,
    });
    events.set(`${event.title}\u0000${event.startsOn}\u0000${event.venue}`, event);
  }
  if (events.size === 0) invalid(source);
  return [...events.values()].filter((event) => isFuture(event.startsOn));
}
