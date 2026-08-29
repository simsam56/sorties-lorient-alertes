import { load } from "cheerio";
import { createEvent, parseFrenchDate } from "../model.mjs";

export function parseMapado(html, source) {
  const $ = load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) throw new Error(`${source.name}: signature Mapado absente`);

  const data = JSON.parse(raw);
  const items = data?.props?.pageProps?.entities?.ticketings?.["hydra:member"];
  if (!Array.isArray(items)) throw new Error(`${source.name}: collection Mapado absente`);
  if (items.some((item) => !item || typeof item !== "object")) {
    throw new Error(`${source.name}: structure Mapado invalide`);
  }

  return items
    .filter((item) => item.type === "dated_events" && item.isOnSale && item.availabilityStatus === "onSale")
    .map((item) => {
      const schedules = Object.values(item.sellingDeviceSchedule ?? {});
      if (schedules.some((entry) => !entry || typeof entry !== "object")) {
        throw new Error(`${source.name}: structure Mapado invalide`);
      }
      const labels = schedules
        .map((entry) => entry.fr)
        .filter(Boolean);
      const startsOn = labels.map(parseFrenchDate).find(Boolean);
      return createEvent({
        title: item.title,
        startsOn,
        startsAt: null,
        venue: item.venue?.name ?? source.venue,
        city: item.venue?.city ?? source.city,
        bookingUrl: new URL(`/event/${item.slug}`, source.url).href,
        sourceUrl: source.url,
        sourceId: source.id,
      });
    });
}
