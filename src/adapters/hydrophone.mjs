import { load } from "cheerio";
import { createEvent } from "../model.mjs";

const TICKETING_HOST = "billetterie.hydrophone.fr";
const API_PATH = "/api/v2";

function apiInvalid(source, detail = "signature API officielle absente") {
  throw new Error(`${source.name}: ${detail}`);
}

function officialTicketingSource(source) {
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && url.hostname === TICKETING_HOST &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function parisDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const field = (type) => parts.find((part) => part.type === type)?.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

function officialPublicLink(raw, id) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const sessionId = String(id);
  return url.protocol === "https:" && url.hostname === TICKETING_HOST &&
    url.port === "" && url.username === "" && url.password === "" && url.hash === "" &&
    /^\/agenda\/\d+-[^/]+$/u.test(url.pathname) &&
    url.pathname.startsWith(`/agenda/${sessionId}-`) &&
    url.searchParams.size === 1 && url.searchParams.get("session") === sessionId ? url.href : null;
}

function validEventRecord(record) {
  return Number.isInteger(record?.id) && record.id > 0 &&
    typeof record.edito?.title === "string" && record.edito.title.trim() !== "" &&
    Number.isInteger(record.start_date) &&
    typeof record.location?.title === "string" && typeof record.location?.city === "string" &&
    typeof record.public_link === "string" &&
    typeof record.infos_status?.publication === "string" &&
    typeof record.infos_status?.available === "boolean" &&
    typeof record.infos_status?.closed === "boolean" &&
    Array.isArray(record.infos_status?.additionnals) &&
    record.infos_status.additionnals.every((status) => status && typeof status.key === "string") &&
    typeof record.settings?.pass?.is_pass === "boolean";
}

export function buildHydrophoneSessionsRequest(html, source) {
  if (!officialTicketingSource(source)) apiInvalid(source);
  const $ = load(html);
  const app = $("sonic-tickets-app").first();
  const token = app.attr("token") ?? "";
  if (app.attr("serviceurl") !== API_PATH || !/^[A-Za-z0-9._-]{20,4096}$/u.test(token)) apiInvalid(source);

  const url = new URL(`${API_PATH}/sessions`, source.url);
  url.searchParams.set("next", "1");
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  for (const feature of ["location", "status", "settings"]) url.searchParams.append("features[]", feature);
  return {
    url: url.href,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  };
}

export function parseHydrophoneSessions(raw, source, now = new Date()) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    apiInvalid(source, "réponse API invalide");
  }
  if (payload?.success !== true || !Array.isArray(payload.data) ||
      !Number.isInteger(payload.total) || payload.total !== payload.data.length) {
    apiInvalid(source, "réponse API invalide");
  }

  const today = parisDate(now);
  const events = [];
  for (const record of payload.data) {
    if (!record || record.entity_type !== "event") continue;
    if (!validEventRecord(record)) apiInvalid(source, "session API invalide");
    const canceled = Array.isArray(record.infos_status?.additionnals) &&
      record.infos_status.additionnals.some((status) => status?.key === "canceled");
    const isHydrophone = record.location?.title?.trim().toUpperCase() === "HYDROPHONE" &&
      record.location?.city?.trim().toUpperCase() === "LORIENT";
    const sellable = record.infos_status?.publication === "on_sale" &&
      record.infos_status?.available === true && record.infos_status?.closed === false;
    if (!isHydrophone || !sellable || canceled || record.settings?.pass?.is_pass === true) continue;

    const startsAt = Number.isInteger(record.start_date) ? new Date(record.start_date * 1000) : null;
    const startsOn = startsAt && !Number.isNaN(startsAt.getTime()) ? parisDate(startsAt) : null;
    const title = typeof record.edito?.title === "string" ? record.edito.title.trim() : "";
    const bookingUrl = officialPublicLink(record.public_link, record.id);
    if (!startsOn || !bookingUrl) {
      apiInvalid(source, "session API invalide");
    }
    if (startsOn <= today) continue;
    events.push(createEvent({
      title,
      startsOn,
      startsAt: null,
      venue: source.venue,
      city: source.city,
      bookingUrl,
      sourceUrl: source.homeUrl,
      sourceId: source.id,
    }));
  }
  return events;
}
