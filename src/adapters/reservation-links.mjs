import { load } from "cheerio";
import { createEvent } from "../model.mjs";

const DENIED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com",
  "x.com", "twitter.com", "www.youtube.com",
]);
const BOOKING_WORDS = /billetterie|réserver|reservation|acheter|tickets?|places?/iu;
const NON_CULTURAL = /salon|congrès|forum|séminaire|emploi|crossfit|compétition sportive/iu;
const CULTURAL = /concert|spectacle|théâtre|humour|danse|cirque|festival|jeune public/iu;

function assertCandidate(candidate) {
  const validDetailUrl = typeof candidate?.detailUrl === "string" && (() => {
    try {
      return new URL(candidate.detailUrl).protocol === "https:";
    } catch {
      return false;
    }
  })();
  if (!candidate || !candidate.title || !candidate.venue || !candidate.city || !candidate.sourceId ||
      !/^20\d{2}-\d{2}-\d{2}$/u.test(candidate.startsOn ?? "") || !validDetailUrl) {
    throw new Error("Candidat invalide");
  }
}

export function findReservationUrl(html, detailUrl) {
  const $ = load(html);
  for (const element of $("a[href]").toArray()) {
    const label = $(element).text().trim();
    const href = new URL($(element).attr("href"), detailUrl);
    if (href.protocol !== "https:" || DENIED_HOSTS.has(href.hostname)) continue;
    if (BOOKING_WORDS.test(`${label} ${href.href}`) && href.href !== detailUrl) return href.href;
  }
  return null;
}

export function resolveReservation(html, candidate) {
  assertCandidate(candidate);
  const bookingUrl = findReservationUrl(html, candidate.detailUrl);
  if (!bookingUrl) return null;

  const $ = load(html);
  const categories = $(".category, .categorie, [class*='category'], [class*='categorie']").text();
  if (NON_CULTURAL.test(`${candidate.title} ${categories}`) && !CULTURAL.test(categories)) return null;

  return createEvent({
    title: candidate.title,
    startsOn: candidate.startsOn,
    startsAt: null,
    venue: candidate.venue,
    city: candidate.city,
    bookingUrl,
    sourceUrl: candidate.detailUrl,
    sourceId: candidate.sourceId,
  });
}
