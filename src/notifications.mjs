import { canonicalEventId } from "./model.mjs";

const MAX_MESSAGE_BYTES = 4_096;
const EVENT_TAGS = Object.freeze(["ticket", "performing_arts"]);
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeZone: "Europe/Paris",
});

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
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
  const fixedBytes = byteLength(eventLine(event, ""));
  if (fixedBytes > maxBytes) return eventLine(event, "").slice(0, maxBytes);

  let title = "";
  for (const character of event.title) {
    const candidate = `${title}${character}`;
    if (byteLength(eventLine(event, `${candidate}…`)) > maxBytes) break;
    title = candidate;
  }
  return eventLine(event, `${title}…`);
}

function sourceLink(event) {
  return `[Voir la programmation](${event.sourceUrl})`;
}

function digestMessage(events) {
  const lines = events.map((event) => eventLine(event));
  const complete = lines.join("\n\n");
  if (byteLength(complete) <= MAX_MESSAGE_BYTES) return complete;

  const included = [];
  for (let index = 0; index < events.length; index += 1) {
    const omitted = events.length - index - 1;
    const ending = `… et ${omitted} autres événements\n${sourceLink(events[0])}`;
    const candidate = [...included, lines[index], ending].join("\n\n");
    if (byteLength(candidate) <= MAX_MESSAGE_BYTES) {
      included.push(lines[index]);
      continue;
    }
    if (included.length === 0) {
      const separatorBytes = byteLength(`\n\n${ending}`);
      included.push(clippedEventLine(events[index], MAX_MESSAGE_BYTES - separatorBytes));
    }
    break;
  }

  const omitted = events.length - included.length;
  return [...included, `… et ${omitted} autres événements\n${sourceLink(events[0])}`].join("\n\n");
}

function eventNotification(event) {
  return {
    ids: [canonicalEventId(event)],
    title: "Nouvelle sortie près de Lorient",
    message: eventLine(event),
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
  return {
    ids: [`${kind}:${source.id}`],
    title: isIncident
      ? `Incident de surveillance : ${source.name}`
      : `Surveillance rétablie : ${source.name}`,
    message: isIncident
      ? `${source.name} est en échec depuis ${consecutiveFailures} contrôles consécutifs.\n[Ouvrir la source](${source.url})`
      : `${source.name} est de nouveau accessible.\n[Ouvrir la source](${source.url})`,
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
