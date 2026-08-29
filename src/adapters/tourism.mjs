import { load } from "cheerio";
import { parseFrenchDate } from "../model.mjs";

const TOURISM_HOST = "www.lorientbretagnesudtourisme.fr";

function placeParts(text) {
  const match = text.trim().match(/^(.*?)(?:\s*,\s*|\s+[–—-]\s+)([^,]+)$/u);
  if (!match) return null;
  return { venue: match[1].trim(), city: match[2].trim() };
}

function invalid(source) {
  throw new Error(`${source.name}: signature Tourisme invalide`);
}

function officialDetailUrl(href, source) {
  let detailUrl;
  try {
    detailUrl = new URL(href, source.url);
  } catch {
    invalid(source);
  }
  if (detailUrl.protocol !== "https:" || detailUrl.hostname !== TOURISM_HOST ||
      !/^\/fr\/fiche\/.+\/$/u.test(detailUrl.pathname)) invalid(source);
  return detailUrl;
}

export function parseTourismCandidates(html, source) {
  const $ = load(html);
  const cards = $(".list-item .content").toArray();
  if (cards.length === 0) {
    throw new Error(`${source.name}: signature Tourisme absente`);
  }

  const candidates = new Map();
  for (const card of cards) {
    const detail = $(card).find("h2 .dsio-detail-button[href]").first();
    const href = detail.attr("href");
    if (!href) invalid(source);

    const detailUrl = officialDetailUrl(href, source);

    const place = placeParts($(card).find(".place").first().text());
    const title = detail.text().trim();
    const startsOn = parseFrenchDate($(card).find(".date strong").first().text());
    if (!title || !startsOn || !place?.venue || !place.city || !source.id) invalid(source);

    candidates.set(detailUrl.href, {
      title,
      startsOn,
      venue: place.venue,
      city: place.city,
      detailUrl: detailUrl.href,
      sourceId: source.id,
    });
  }
  return [...candidates.values()];
}
