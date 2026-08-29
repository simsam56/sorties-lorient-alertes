import test from "node:test";
import assert from "node:assert/strict";

import { canonicalEventId, createEvent } from "../src/model.mjs";
import {
  buildEventNotifications,
  buildHealthNotifications,
} from "../src/notifications.mjs";

function event(overrides = {}) {
  return createEvent({
    title: "Concert témoin",
    startsOn: "2026-10-15",
    startsAt: null,
    venue: "Hydrophone",
    city: "Lorient",
    bookingUrl: "https://billetterie.example.test/concert-temoin",
    sourceUrl: "https://www.hydrophone.fr/programmation",
    sourceId: "hydrophone",
    ...overrides,
  });
}

test("compose une notification individuelle avec date, lieu et lien de réservation", () => {
  const observed = event({ title: "Émilie Simon", startsOn: "2026-10-18" });

  assert.deepEqual(buildEventNotifications([observed]), [{
    ids: [canonicalEventId(observed)],
    title: "Nouvelle sortie près de Lorient",
    message: "[Émilie Simon](https://billetterie.example.test/concert-temoin)\nDimanche 18 octobre 2026 — Hydrophone, Lorient",
    clickUrl: "https://billetterie.example.test/concert-temoin",
    priority: 4,
    tags: ["ticket", "performing_arts"],
    markdown: true,
  }]);
});

test("conserve une notification par événement lorsqu'il y en a deux", () => {
  const first = event({ title: "Premier concert" });
  const second = event({ title: "Second spectacle", startsOn: "2026-10-16" });

  const notifications = buildEventNotifications([first, second]);

  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications.map(({ ids }) => ids), [
    [canonicalEventId(first)],
    [canonicalEventId(second)],
  ]);
  assert.match(notifications[0].message, /Premier concert/u);
  assert.match(notifications[1].message, /Second spectacle/u);
});

test("regroupe trois nouveautés dans un digest Markdown complet", () => {
  const events = [
    event({ title: "Concert A", startsOn: "2026-10-15", venue: "Hydrophone", city: "Lorient" }),
    event({ title: "Pièce B", startsOn: "2026-10-16", venue: "Le City", city: "Lorient" }),
    event({ title: "Danse C", startsOn: "2026-10-17", venue: "Océanis", city: "Ploemeur" }),
  ];

  const [notification] = buildEventNotifications(events);

  assert.deepEqual(notification.ids, events.map(canonicalEventId));
  assert.equal(notification.title, "3 nouvelles sorties dans l'agglomération");
  assert.equal(notification.markdown, true);
  for (const observed of events) {
    assert.match(notification.message, new RegExp(`\\[${observed.title}\\]\\(${observed.bookingUrl}\\)`, "u"));
    assert.match(notification.message, new RegExp(observed.venue, "u"));
    assert.match(notification.message, /octobre 2026/u);
  }
});

test("tronque un digest Unicode à 4 096 octets sans couper son renvoi Markdown", () => {
  const events = Array.from({ length: 12 }, (_, index) => event({
    title: `Événement ${index + 1} ${"🎭é".repeat(900)}`,
    startsOn: `2026-11-${String(index + 1).padStart(2, "0")}`,
    bookingUrl: `https://billetterie.example.test/${index + 1}`,
  }));

  const [notification] = buildEventNotifications(events);
  const suffix = "… et 11 autres événements\n[Voir la programmation](https://www.hydrophone.fr/programmation)";

  assert.ok(Buffer.byteLength(notification.message, "utf8") <= 4_096);
  assert.ok(notification.message.endsWith(suffix));
  assert.match(notification.message, /^\[Événement 1 /u);
  assert.equal(notification.ids.length, 12);
});

test("compose les alertes techniques d'incident et de rétablissement", () => {
  const source = {
    id: "hydrophone",
    name: "Hydrophone",
    url: "https://www.hydrophone.fr/programmation",
  };

  const notifications = buildHealthNotifications(
    [{ source, consecutiveFailures: 4 }],
    [{ source }],
  );

  assert.deepEqual(notifications, [
    {
      ids: ["incident:hydrophone"],
      title: "Incident de surveillance : Hydrophone",
      message: "Hydrophone est en échec depuis 4 contrôles consécutifs.\n[Ouvrir la source](https://www.hydrophone.fr/programmation)",
      clickUrl: source.url,
      priority: 4,
      tags: ["warning"],
      markdown: true,
    },
    {
      ids: ["recovery:hydrophone"],
      title: "Surveillance rétablie : Hydrophone",
      message: "Hydrophone est de nouveau accessible.\n[Ouvrir la source](https://www.hydrophone.fr/programmation)",
      clickUrl: source.url,
      priority: 3,
      tags: ["white_check_mark"],
      markdown: true,
    },
  ]);
});
