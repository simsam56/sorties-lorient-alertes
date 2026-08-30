import { load } from "cheerio";
import { createEvent } from "../model.mjs";

const DENIED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com",
  "x.com", "twitter.com", "www.youtube.com",
]);
// Les domaines de revente ne sont jamais des billetteries officielles, y compris leurs sous-domaines.
const RESALE_DOMAINS = ["ticketswap.com"];
const BOOKING_WORDS = /billetterie|réserver|reservation|acheter|tickets?|places?/iu;
const NON_CULTURAL = /salon|congrès|forum|séminaire|emploi|crossfit|compétition sportive/iu;
const CULTURAL = /concert|spectacle|théâtre|humour|danse|cirque|festival|familial|famille|jeune public|jeunesse/iu;

function deniedHost(hostname) {
  return DENIED_HOSTS.has(hostname) || RESALE_DOMAINS.some((domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function sameDocument(left, right) {
  return left.origin === right.origin && left.pathname === right.pathname;
}

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

export function findReservationUrl(html, detailUrl, selector = null) {
  const $ = load(html);
  let detail;
  try {
    detail = new URL(detailUrl);
  } catch {
    throw new Error(`Lien de réservation invalide: URL de détail ${detailUrl}`);
  }
  const elements = (selector ? $(selector).find("a[href]") : $("a[href]")).toArray()
    .sort((left, right) => Number(/pmr|handicap/iu.test($(left).text())) - Number(/pmr|handicap/iu.test($(right).text())));
  for (const element of elements) {
    const label = $(element).text().trim();
    const rawHref = $(element).attr("href");
    let href;
    try {
      href = new URL(rawHref, detail);
    } catch {
      throw new Error(`Lien de réservation invalide: ${rawHref}`);
    }
    if (href.protocol !== "https:" || deniedHost(href.hostname)) continue;
    if (BOOKING_WORDS.test(`${label} ${href.href}`) && !sameDocument(href, detail)) return href.href;
  }
  return null;
}

export function resolveReservation(html, candidate) {
  assertCandidate(candidate);
  const $ = load(html);
  const isLorientEvents = candidate.sourceId === "lorient-events";
  const lorientMain = $("main.single-evenement__content");
  if (isLorientEvents && lorientMain.length !== 1) {
    throw new Error("Lorient Bretagne Sud Événements: signature de fiche absente");
  }
  const bookingUrl = findReservationUrl(
    html,
    candidate.detailUrl,
    isLorientEvents ? "main.single-evenement__content .single-evenement__tarifs" : null,
  );
  if (!bookingUrl) return null;

  const categorySelector = ".category, .categorie, [class*='category'], [class*='categorie']";
  const categories = (isLorientEvents ? lorientMain.find(categorySelector) : $(categorySelector)).text();
  const description = isLorientEvents
    ? lorientMain.find(":scope > div > .content-style").first().text()
    : "";
  const classification = `${candidate.title} ${categories} ${description}`;
  if (!CULTURAL.test(classification)) return null;
  if (NON_CULTURAL.test(candidate.title)) return null;
  if (!isLorientEvents && NON_CULTURAL.test(classification) && !CULTURAL.test(categories)) return null;

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
