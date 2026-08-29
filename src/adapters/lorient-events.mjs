import { load } from "cheerio";
import { parseFrenchDate } from "../model.mjs";

function placeParts(text) {
  const match = text.trim().match(/^(.*?)(?:\s*,\s*|\s+[–—-]\s+)([^,]+)$/u);
  if (!match) return null;
  return { venue: match[1].trim(), city: match[2].trim() };
}

function isAgendaDetail(url) {
  return url.protocol === "https:" &&
    url.hostname === "lorient-evenements.bzh" &&
    /^\/agenda\/(?!feed\/)[^/]+\/?$/u.test(url.pathname);
}

function invalid(source) {
  throw new Error(`${source.name}: signature Lorient Événements invalide`);
}

function cardFor($, element) {
  const card = $(element).closest("article, .event-card, .card, .agenda-item");
  if (card.length) return card;

  const listItem = $(element).closest("li");
  const hasEventFields = listItem.find(
    "time, .date, [class*='date'], .location, .place, [class*='location'], [class*='place'], [class*='lieu']",
  ).length > 0;
  return hasEventFields ? listItem : null;
}

export function parseLorientEventsCandidates(html, source) {
  const $ = load(html);
  const details = $("a[href]").toArray().map((element) => {
    const card = cardFor($, element);
    if (!card) return null;
    return { card, url: new URL($(element).attr("href"), source.url) };
  }).filter((detail) => detail && isAgendaDetail(detail.url));

  if (details.length === 0) {
    throw new Error(`${source.name}: signature Lorient Événements absente`);
  }

  const candidates = new Map();
  for (const { card, url } of details) {
    const title = card.find("h1, h2, h3, .title, [class*='title']").first().text().trim();
    const startsOn = parseFrenchDate(card.find("time, .date, [class*='date']").first().text());
    const place = placeParts(card.find(".location, .place, [class*='location'], [class*='place'], [class*='lieu']").first().text());
    if (!title || !startsOn || !place?.venue || !place.city || !source.id) invalid(source);

    candidates.set(url.href, {
      title,
      startsOn,
      venue: place.venue,
      city: place.city,
      detailUrl: url.href,
      sourceId: source.id,
    });
  }
  return [...candidates.values()];
}
