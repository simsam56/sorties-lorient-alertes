import { canonicalEventId } from "./model.mjs";

const MAX_MESSAGE_BYTES = 4_096;
const EVENT_TAGS = Object.freeze(["ticket", "performing_arts"]);
const RESERVATION_OMITTED = "Lien de réservation indisponible dans ce message — ouvrez la notification.";
const SOURCE_OMITTED = "Source indisponible dans ce message — ouvrez la notification.";
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeZone: "Europe/Paris",
});

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value, maxBytes) {
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (byteLength(value) <= budget) return value;
  if (budget < byteLength("…")) return "";

  let result = "";
  for (const character of value) {
    if (byteLength(`${result}${character}…`) > budget) break;
    result += character;
  }
  return `${result}…`;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\[\]])/gu, "\\$1");
}

function formatDate(startsOn) {
  const formatted = dateFormatter.format(new Date(`${startsOn}T12:00:00.000Z`));
  return `${formatted.slice(0, 1).toLocaleUpperCase("fr-FR")}${formatted.slice(1)}`;
}

function compareEvents(left, right) {
  return [
    left.startsOn,
    left.startsAt ?? "",
    left.city,
    left.venue,
    left.title,
    left.bookingUrl,
  ].join("\u0000").localeCompare([
    right.startsOn,
    right.startsAt ?? "",
    right.city,
    right.venue,
    right.title,
    right.bookingUrl,
  ].join("\u0000"), "fr");
}

function eventLine(event, title = event.title) {
  return `[${escapeMarkdown(title)}](${event.bookingUrl})\n${formatDate(event.startsOn)} — ${escapeMarkdown(event.venue)}, ${escapeMarkdown(event.city)}`;
}

function clippedEventLine(event, maxBytes) {
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  const fixedBytes = byteLength(eventLine(event, ""));
  if (fixedBytes > budget) return null;

  let title = "";
  for (const character of event.title) {
    const candidate = `${title}${character}`;
    if (byteLength(eventLine(event, `${candidate}…`)) > budget) break;
    title = candidate;
  }
  const decorated = byteLength(eventLine(event, `${title}…`)) <= budget ? `${title}…` : title;
  return eventLine(event, decorated);
}

function reservationFallback(event, maxBytes) {
  return truncateUtf8(
    `${RESERVATION_OMITTED}\n${escapeMarkdown(event.title)}\n${formatDate(event.startsOn)} — ${escapeMarkdown(event.venue)}, ${escapeMarkdown(event.city)}`,
    maxBytes,
  );
}

function boundedEventLine(event, maxBytes) {
  const full = eventLine(event);
  if (byteLength(full) <= maxBytes) return full;
  return clippedEventLine(event, maxBytes) ?? reservationFallback(event, maxBytes);
}

function sourceReference(sourceUrl, maxBytes, label = "Voir la programmation") {
  const full = `[${label}](${sourceUrl})`;
  if (byteLength(full) <= maxBytes) return full;
  return truncateUtf8(SOURCE_OMITTED, maxBytes);
}

function digestFooter(event, omitted, maxBytes) {
  const prefix = omitted === 0 ? "" : `… et ${omitted} autres événements\n`;
  return `${prefix}${sourceReference(event.sourceUrl, maxBytes - byteLength(prefix))}`;
}

function digestMessage(events) {
  const lines = events.map((event) => eventLine(event));
  const complete = lines.join("\n\n");
  if (byteLength(complete) <= MAX_MESSAGE_BYTES) return complete;

  const included = [];
  for (let index = 0; index < events.length; index += 1) {
    const omitted = events.length - index - 1;
    const footer = digestFooter(events[0], omitted, MAX_MESSAGE_BYTES);
    const prefix = included.length === 0 ? "" : `${included.join("\n\n")}\n\n`;
    const available = MAX_MESSAGE_BYTES - byteLength(prefix) - byteLength(`\n\n${footer}`);
    const line = boundedEventLine(events[index], available);
    if (line === "" || byteLength(`${prefix}${line}\n\n${footer}`) > MAX_MESSAGE_BYTES) break;
    included.push(line);
  }

  const omitted = events.length - included.length;
  return [...included, digestFooter(events[0], omitted, MAX_MESSAGE_BYTES)].join("\n\n");
}

function eventNotification(event) {
  return {
    ids: [canonicalEventId(event)],
    title: "Nouvelle sortie près de Lorient",
    message: boundedEventLine(event, MAX_MESSAGE_BYTES),
    clickUrl: event.bookingUrl,
    priority: 4,
    tags: [...EVENT_TAGS],
    markdown: true,
  };
}

export function buildEventNotifications(events) {
  if (!Array.isArray(events)) throw new Error("Événements à notifier invalides");
  const ordered = [...events].sort(compareEvents);
  if (ordered.length < 3) return ordered.map(eventNotification);
  return [{
    ids: ordered.map(canonicalEventId),
    title: `${ordered.length} nouvelles sorties dans l'agglomération`,
    message: digestMessage(ordered),
    clickUrl: ordered[0].sourceUrl,
    priority: 4,
    tags: [...EVENT_TAGS],
    markdown: true,
  }];
}

function sourceLinkNotification({ source, kind, consecutiveFailures }) {
  const isIncident = kind === "incident";
  const messagePrefix = isIncident
    ? `${source.name} est en échec depuis ${consecutiveFailures} contrôles consécutifs.`
    : `${source.name} est de nouveau accessible.`;
  const sourceText = sourceReference(
    source.url,
    MAX_MESSAGE_BYTES - byteLength(`${messagePrefix}\n`),
    "Ouvrir la source",
  );
  return {
    ids: [`${kind}:${source.id}`],
    title: isIncident
      ? `Incident de surveillance : ${source.name}`
      : `Surveillance rétablie : ${source.name}`,
    message: truncateUtf8(`${messagePrefix}\n${sourceText}`, MAX_MESSAGE_BYTES),
    clickUrl: source.url,
    priority: isIncident ? 4 : 3,
    tags: [isIncident ? "warning" : "white_check_mark"],
    markdown: true,
  };
}

export function buildHealthNotifications(incidents, recoveries) {
  if (!Array.isArray(incidents) || !Array.isArray(recoveries)) {
    throw new Error("État de santé à notifier invalide");
  }
  return [
    ...incidents.map((incident) => sourceLinkNotification({
      source: incident.source,
      kind: "incident",
      consecutiveFailures: incident.consecutiveFailures,
    })),
    ...recoveries.map((recovery) => sourceLinkNotification({
      source: recovery.source,
      kind: "recovery",
    })),
  ];
}
