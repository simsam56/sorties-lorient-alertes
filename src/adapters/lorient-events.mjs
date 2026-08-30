import { load } from "cheerio";
const VENUE_CITIES = new Map([
  ["Palais des Congrès", "Lorient"],
  ["Parc des Expositions", "Lanester"],
  ["Espace événementiel K2", "Lorient"],
]);

function isAgendaDetail(url) {
  return url.protocol === "https:" &&
    url.hostname === "lorient-evenements.bzh" &&
    /^\/agenda\/(?!feed\/)[^/]+\/?$/u.test(url.pathname);
}

function invalid(source) {
  throw new Error(`${source.name}: signature Lorient Événements invalide`);
}

function validIsoDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseLorientEventsCandidates(html, source) {
  const $ = load(html);
  const details = $("ul.archive-evenement__list > li > a[href]").toArray().map((element) => {
    let url;
    try {
      url = new URL($(element).attr("href"), source.url);
    } catch {
      invalid(source);
    }
    const card = $(element).find("figure.evenement-card").first();
    return card.length && isAgendaDetail(url) ? { card, url } : null;
  }).filter(Boolean);

  if (details.length === 0) {
    throw new Error(`${source.name}: signature Lorient Événements absente`);
  }

  const candidates = new Map();
  for (const { card, url } of details) {
    const title = card.find(".evenement-card__title").first().text().trim();
    const startsOn = card.find(".evenement-card__date time[datetime]").first().attr("datetime");
    const venue = card.find(".evenement-card__location").first().text().trim().replace(/\s+/gu, " ");
    const city = VENUE_CITIES.get(venue);
    if (!title || !validIsoDate(startsOn) || !city || !source.id) invalid(source);

    candidates.set(url.href, {
      title,
      startsOn,
      venue,
      city,
      detailUrl: url.href,
      sourceId: source.id,
    });
  }
  return [...candidates.values()];
}
