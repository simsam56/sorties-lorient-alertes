# Lorient Events Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a GitHub Actions monitor that alerts a dedicated ntfy topic when a new reservable concert or show appears anywhere in Lorient Agglomération.

**Architecture:** Source adapters convert official venue and territorial pages into one strict event contract. A collector isolates failures, a deterministic deduplicator and versioned state engine identify genuinely new sales, and a notifier emits individual or grouped ntfy messages. GitHub Actions runs the monitor every fifteen minutes and persists state on a dedicated branch.

**Tech Stack:** Node.js 22, ES modules, Node test runner, Cheerio 1.2.0, GitHub Actions, ntfy HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-29-surveillance-sorties-lorient-design.md`

## Global Constraints

- Cover every commune of Lorient Agglomération; do not restrict results to Lorient city.
- Include concerts, festivals, theatre, comedy, dance, circus, hybrid and family shows, including free events that require a reservation.
- Exclude resale, ordinary cinema, professional fairs, non-cultural events and events without an accessible reservation URL.
- Poll direct ticketing sources every 15 minutes and territorial discovery sources every 60 minutes.
- First successful observation of each source establishes a silent baseline for that source.
- One or two new canonical events produce individual notifications; three or more in one run produce one digest.
- Four consecutive failures for one source open one technical incident; the first later success emits one recovery notification.
- Never silently reset malformed state and never expose `NTFY_TOPIC` in source, state, tests or logs.
- Network requests time out after 15 seconds and a workflow job times out after 10 minutes.
- Keep the public repository active with a monthly heartbeat on the default branch.
- No login, reservation, purchase, resale monitoring, mobile application or recommendation engine.

## File Map

- `package.json`: Node version, Cheerio dependency and project commands.
- `src/model.mjs`: event validation, text/date normalization and canonical identity.
- `src/sources.mjs`: exact source inventory, polling intervals, home URLs and adapter names.
- `src/adapters/mapado.mjs`: Mapado `__NEXT_DATA__` extraction for six official ticketing sites.
- `src/adapters/tourism.mjs`: Lorient Bretagne Sud Tourism list extraction and reservable-detail resolution.
- `src/adapters/lorient-events.mjs`: Palais des Congrès and Parc Expo agenda extraction.
- `src/adapters/theatre-lorient.mjs`: Théâtre de Lorient season and booking-link extraction.
- `src/adapters/hydrophone.mjs`: Hydrophone SPIP programme extraction.
- `src/adapters/trios.mjs`: TRIO…S programme and Vostickets booking extraction.
- `src/adapters/fil.mjs`: Festival Interceltique programme and official ticketing extraction.
- `src/collector.mjs`: due-source selection, bounded fetches and failure isolation.
- `src/dedupe.mjs`: deterministic inter-source merging and preferred booking URL selection.
- `src/state.mjs`: strict schema, per-source baseline, seen events and incident lifecycle.
- `src/notifications.mjs`: individual, digest, incident and recovery messages.
- `src/network.mjs`: HTTP client and ntfy JSON publication.
- `scripts/run-monitor.mjs`: `inspect`, `check` and `test-notification` orchestration.
- `test/fixtures/*.html`: minimal, versioned source samples without personal data.
- `test/*.test.mjs`: unit and CLI/workflow tests.
- `.github/workflows/monitor.yml`: scheduled and manual monitor.
- `.github/workflows/heartbeat.yml`: monthly default-branch activity.
- `README.md`: scope, sources, security, operation and recovery.

---

### Task 1: Project foundation and event contract

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/model.mjs`
- Create: `src/sources.mjs`
- Test: `test/model.test.mjs`
- Test: `test/sources.test.mjs`

**Interfaces:**
- Produces: `createEvent(input): Event`, `canonicalEventId(event): string`, `parseFrenchDate(text): string | null`, `SOURCES: SourceConfig[]`, `getSource(id): SourceConfig`.
- `Event` fields: `{ title, startsOn, startsAt, venue, city, bookingUrl, sourceUrl, sourceId }`.
- `SourceConfig` fields: `{ id, name, url, homeUrl, adapter, pollEveryMinutes, city, venue, enabled, disabledReason }`.

- [ ] **Step 1: Write failing model tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEventId,
  createEvent,
  parseFrenchDate,
} from "../src/model.mjs";

test("normalise un événement sans perdre son lien officiel", () => {
  const event = createEvent({
    title: "  ÉMILY LOIZEAU & Quatuor Debussy ",
    startsOn: "2026-10-15",
    startsAt: null,
    venue: "Grand Théâtre",
    city: "Lorient",
    bookingUrl: "https://billetterie.theatredelorient.fr/event/123",
    sourceUrl: "https://theatredelorient.fr/spectacle/emily-loizeau/",
    sourceId: "theatre-lorient",
  });
  assert.equal(event.title, "ÉMILY LOIZEAU & Quatuor Debussy");
  assert.match(canonicalEventId(event), /^2026-10-15:lorient:grand-theatre:/);
});

test("comprend une date française", () => {
  assert.equal(parseFrenchDate("Sam. 26 sept. 2026 à 20:30"), "2026-09-26");
  assert.equal(parseFrenchDate("Le 8 décembre 2026"), "2026-12-08");
});

test("refuse un événement sans réservation HTTPS", () => {
  assert.throws(
    () => createEvent({
      title: "Concert",
      startsOn: "2026-10-15",
      startsAt: null,
      venue: "Hydrophone",
      city: "Lorient",
      bookingUrl: "mailto:billetterie@example.test",
      sourceUrl: "https://www.hydrophone.fr/concert.html",
      sourceId: "hydrophone",
    }),
    /Événement invalide/,
  );
});
```

- [ ] **Step 2: Run the model tests and verify the missing-module failure**

Run: `node --test test/model.test.mjs`

Expected: FAIL because `src/model.mjs` does not exist.

- [ ] **Step 3: Implement the minimal strict model**

```js
const MONTHS = new Map([
  ["janv", 1], ["janvier", 1], ["févr", 2], ["fevrier", 2],
  ["février", 2], ["mars", 3], ["avr", 4], ["avril", 4],
  ["mai", 5], ["juin", 6], ["juil", 7], ["juillet", 7],
  ["août", 8], ["aout", 8], ["sept", 9], ["septembre", 9],
  ["oct", 10], ["octobre", 10], ["nov", 11], ["novembre", 11],
  ["déc", 12], ["dec", 12], ["décembre", 12], ["decembre", 12],
]);

export function normalizeText(value) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseFrenchDate(text) {
  const match = text.toLowerCase().match(/(\d{1,2})\s+([a-zéû\.]+)\s+(20\d{2})/u);
  if (!match) return null;
  const month = MONTHS.get(match[2].replace(/\.$/, ""));
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function createEvent(input) {
  const event = { ...input, title: input.title?.trim(), venue: input.venue?.trim(), city: input.city?.trim() };
  const urls = [event.bookingUrl, event.sourceUrl].every((value) => {
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  });
  if (!event.title || !/^20\d{2}-\d{2}-\d{2}$/.test(event.startsOn ?? "") ||
      !event.venue || !event.city || !event.sourceId || !urls) {
    throw new Error("Événement invalide");
  }
  return Object.freeze(event);
}

export function canonicalEventId(event) {
  return [event.startsOn, normalizeText(event.city), normalizeText(event.venue), normalizeText(event.title)].join(":");
}
```

- [ ] **Step 4: Define and test the exact source inventory**

Create `src/sources.mjs` with these direct sources:

```js
export const SOURCES = Object.freeze([
  { id: "mapado-estran", name: "L'Estran", url: "https://lestran-guidel.mapado.com/", homeUrl: "https://lestran.net/", adapter: "mapado", pollEveryMinutes: 15, city: "Guidel", venue: "L'Estran" },
  { id: "mapado-oceanis", name: "Océanis", url: "https://billetterieoceanis.mapado.com/", homeUrl: "https://www.ploemeur.com/vivre/oceanis-salle-de-spectacle/", adapter: "mapado", pollEveryMinutes: 15, city: "Ploemeur", venue: "Océanis" },
  { id: "mapado-strapontin", name: "Le Strapontin", url: "https://lestrapontin.mapado.com/", homeUrl: "https://lestrapontin.fr/", adapter: "mapado", pollEveryMinutes: 15, city: "Pont-Scorff", venue: "Le Strapontin" },
  { id: "mapado-quai9", name: "Quai 9", url: "https://billetterie-quai9.mapado.com/", homeUrl: "https://quai9.bzh/", adapter: "mapado", pollEveryMinutes: 15, city: "Lanester", venue: "Quai 9" },
  { id: "mapado-arcs", name: "Les Arcs", url: "https://queven-lesarcs.mapado.com/", homeUrl: "https://www.queven.com/", adapter: "mapado", pollEveryMinutes: 15, city: "Quéven", venue: "Les Arcs" },
  { id: "mapado-coque", name: "Théâtre à la Coque", url: "https://theatrealacoque-cnma.mapado.com/", homeUrl: "https://www.theatrealacoque.fr/", adapter: "mapado", pollEveryMinutes: 15, city: "Hennebont", venue: "Théâtre à la Coque" },
  { id: "tourism", name: "Lorient Bretagne Sud Tourisme", url: "https://www.lorientbretagnesudtourisme.fr/fr/immanquables/lorient/agenda/spectacle/", homeUrl: "https://www.lorientbretagnesudtourisme.fr/fr/agenda/", adapter: "tourism", pollEveryMinutes: 60, city: null, venue: null },
  { id: "lorient-events", name: "Lorient Bretagne Sud Événements", url: "https://lorient-evenements.bzh/agenda/", homeUrl: "https://lorient-evenements.bzh/agenda/", adapter: "lorient-events", pollEveryMinutes: 60, city: null, venue: null },
  { id: "theatre-lorient", name: "Théâtre de Lorient", url: "https://theatredelorient.fr/saison/", homeUrl: "https://theatredelorient.fr/", adapter: "theatre-lorient", pollEveryMinutes: 15, city: "Lorient", venue: "Théâtre de Lorient" },
  { id: "hydrophone", name: "Hydrophone", url: "https://www.hydrophone.fr/-La-programmation-2026-.html", homeUrl: "https://www.hydrophone.fr/", adapter: "hydrophone", pollEveryMinutes: 15, city: "Lorient", venue: "Hydrophone" },
  { id: "trios", name: "TRIO…S", url: "https://www.vostickets.net/billet?id=TRIO", homeUrl: "https://trio-s.fr/", adapter: "trios", pollEveryMinutes: 15, city: null, venue: "TRIO…S" },
  { id: "fil", name: "Festival Interceltique de Lorient", url: "https://www.festival-interceltique.bzh/billetterie-2026/", homeUrl: "https://www.festival-interceltique.bzh/", adapter: "fil", pollEveryMinutes: 60, city: "Lorient", venue: "Festival Interceltique" },
]);

export function getSource(id) {
  const source = SOURCES.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Source inconnue: ${id}`);
  return source;
}
```

Every initial source entry also contains `enabled: true` and `disabledReason: null`. Task 11 may change only those two fields when live evidence does not justify activation.

Test that IDs and URLs are unique, every URL is HTTPS, the six expected Mapado sources exist, and direct/territorial intervals are respectively 15/60 minutes.

- [ ] **Step 5: Run tests and commit the foundation**

Run: `npm test`

Expected: all model and inventory tests PASS.

```bash
git add package.json package-lock.json .gitignore src/model.mjs src/sources.mjs test/model.test.mjs test/sources.test.mjs
git commit -m "feat: define event model and source inventory"
```

---

### Task 2: Official Mapado adapter

**Files:**
- Create: `src/adapters/mapado.mjs`
- Create: `test/fixtures/mapado.html`
- Test: `test/mapado.test.mjs`

**Interfaces:**
- Consumes: `createEvent`, `parseFrenchDate`, `SourceConfig`.
- Produces: `parseMapado(html, source): Event[]`.

- [ ] **Step 1: Save a minimal fixture and write the failing extraction test**

The fixture contains one `<script id="__NEXT_DATA__" type="application/json">` object whose `props.pageProps.entities.ticketings.hydra:member` includes:

```json
{
  "title": "NE PAS PLEURER DEVANT UN COUCHER DE SOLEIL",
  "type": "dated_events",
  "isOnSale": true,
  "availabilityStatus": "onSale",
  "slug": "783527-ne-pas-pleurer-devant-un-coucher-de-soleil",
  "venue": { "name": "Théâtre Le Strapontin", "city": "Pont-Scorff" },
  "sellingDeviceSchedule": {
    "/v1/selling_devices/3326": { "fr": "Sam. 26 sept. 2026 à 17:00 et à 20:00" }
  }
}
```

The fixture also contains an `offer`, a `dated_events` item with `isOnSale: false`, and a duplicate selling-device schedule. Assert that only the on-sale dated event is returned, dated `2026-09-26`, with booking URL `https://lestrapontin.mapado.com/event/783527-ne-pas-pleurer-devant-un-coucher-de-soleil`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/mapado.test.mjs`

Expected: FAIL because `parseMapado` is missing.

- [ ] **Step 3: Implement extraction from Mapado's stable embedded JSON**

Use Cheerio only to locate the script, then parse JSON and map the collection:

```js
export function parseMapado(html, source) {
  const $ = load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) throw new Error(`${source.name}: signature Mapado absente`);
  const data = JSON.parse(raw);
  const items = data?.props?.pageProps?.entities?.ticketings?.["hydra:member"];
  if (!Array.isArray(items)) throw new Error(`${source.name}: collection Mapado absente`);
  return items
    .filter((item) => item.type === "dated_events" && item.isOnSale && item.availabilityStatus === "onSale")
    .map((item) => {
      const labels = Object.values(item.sellingDeviceSchedule ?? {}).map((entry) => entry.fr).filter(Boolean);
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
```

- [ ] **Step 4: Add corruption and filtering tests**

Assert explicit failures for a foreign login page, invalid JSON and missing `hydra:member`. Assert that offers, gift cards, subscriptions, off-sale and passed/closed items never become events.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/adapters/mapado.mjs test/mapado.test.mjs test/fixtures/mapado.html
git commit -m "feat: extract official Mapado ticket sales"
```

---

### Task 3: Territorial discovery adapters

**Files:**
- Create: `src/adapters/reservation-links.mjs`
- Create: `src/adapters/tourism.mjs`
- Create: `src/adapters/lorient-events.mjs`
- Create: `test/fixtures/tourism-list.html`
- Create: `test/fixtures/tourism-detail.html`
- Create: `test/fixtures/lorient-events-list.html`
- Create: `test/fixtures/lorient-events-detail.html`
- Test: `test/territorial-adapters.test.mjs`

**Interfaces:**
- Produces: `parseTourismCandidates(html, source): Candidate[]`, `parseLorientEventsCandidates(html, source): Candidate[]`, `resolveReservation(html, candidate): Event | null`.
- `Candidate` fields: `{ title, startsOn, venue, city, detailUrl, sourceId }`.

- [ ] **Step 1: Write failing discovery tests from minimal official card markup**

Use the Tourism markers `.list-item`, `h2 .dsio-detail-button`, `.place`, `.date strong` and `/fr/fiche/.../`. Use the Lorient Events marker `/agenda/<slug>/` and its card title/date/location nodes. Assert absolute detail URLs, parsed French dates and deduplication of repeated anchors.

- [ ] **Step 2: Run the tests and verify missing adapters**

Run: `node --test test/territorial-adapters.test.mjs`

Expected: FAIL because the three modules are missing.

- [ ] **Step 3: Implement list discovery without treating detail pages as bookings**

`parseTourismCandidates` returns candidates from `.list-item .content`; `parseLorientEventsCandidates` returns candidates only from cards whose URL matches `^https://lorient-evenements\.bzh/agenda/(?!feed/)`. Neither adapter sets `bookingUrl` from a detail page.

- [ ] **Step 4: Implement conservative reservation resolution**

```js
const DENIED_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com",
  "x.com", "twitter.com", "www.youtube.com",
]);
const BOOKING_WORDS = /billetterie|réserver|reservation|acheter|tickets?|places?/i;

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
```

`resolveReservation` returns `null` without a booking URL. It rejects titles or category labels matching `/salon|congrès|forum|séminaire|emploi|crossfit|compétition sportive/i` unless the detail explicitly contains a cultural category (`concert`, `spectacle`, `théâtre`, `humour`, `danse`, `cirque`, `festival`, `jeune public`).

- [ ] **Step 5: Test non-reservable and non-cultural exclusions**

Assert that an event with only email/phone contact returns `null`, a professional fair with a ticket link returns `null`, and a free family show with an HTTPS reservation link returns an `Event`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/adapters/reservation-links.mjs src/adapters/tourism.mjs src/adapters/lorient-events.mjs test/territorial-adapters.test.mjs test/fixtures/tourism-*.html test/fixtures/lorient-events-*.html
git commit -m "feat: discover reservable territorial events"
```

---

### Task 4: Direct venue and festival adapters

**Files:**
- Create: `src/adapters/theatre-lorient.mjs`
- Create: `src/adapters/hydrophone.mjs`
- Create: `src/adapters/trios.mjs`
- Create: `src/adapters/fil.mjs`
- Create: `test/fixtures/theatre-lorient.html`
- Create: `test/fixtures/hydrophone.html`
- Create: `test/fixtures/trios.html`
- Create: `test/fixtures/fil.html`
- Test: `test/direct-adapters.test.mjs`

**Interfaces:**
- Produces: `parseTheatreLorient(html, source): Event[]`, `parseHydrophone(html, source): Event[]`, `parseTrios(html, source): Event[]`, `parseFil(html, source): Event[]`.

- [ ] **Step 1: Write failing tests for the four real page families**

Fixtures retain only the structural markers needed by each parser:

- Théâtre de Lorient: `/spectacle/<slug>/`, displayed date, room, and `billetterie.theatredelorient.fr` link.
- Hydrophone: programme detail links ending in `.html`, date/venue text, and `billetterie.hydrophone.fr` link.
- TRIO…S/Vostickets: the returned production card, performance date, location and its selectable booking action.
- FIL: the current `/billetterie-<year>/` page and official external reservation links.

Each test asserts one complete `Event`, ignores navigation and subscription/gift-card links, and rejects a page missing its official signature.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test test/direct-adapters.test.mjs`

Expected: FAIL because the direct adapters do not exist.

- [ ] **Step 3: Implement Theatre and Hydrophone parsers**

Use Cheerio with path allowlists rather than fragile visual class names. Theatre event links must match `/spectacle/`; Hydrophone event links must be same-origin `.html` pages outside navigation filenames. Read the first valid French date and use the official ticket host as `bookingUrl`. Collapse repeated performance links with the same title/date/venue.

- [ ] **Step 4: Implement TRIO…S and FIL parsers**

For Vostickets, require the TRIO site link and production-card image path `/public/site/902/spectacle/<id>/` before accepting the page. For FIL, require the Festival Interceltique domain and a heading containing `Billetterie`; accept only event links on the current ticketing domain, never social or resale links.

- [ ] **Step 5: Add explicit no-sale behavior**

All four adapters return an empty array only when the expected official signature is present and the page explicitly has no reservable event. A protection page, login page or changed layout throws `<source>: signature officielle absente`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/adapters/theatre-lorient.mjs src/adapters/hydrophone.mjs src/adapters/trios.mjs src/adapters/fil.mjs test/direct-adapters.test.mjs test/fixtures/theatre-lorient.html test/fixtures/hydrophone.html test/fixtures/trios.html test/fixtures/fil.html
git commit -m "feat: extract direct venue ticket sales"
```

---

### Task 5: Collection, scheduling and failure isolation

**Files:**
- Create: `src/collector.mjs`
- Test: `test/collector.test.mjs`

**Interfaces:**
- Consumes: `SOURCES`, adapter functions and `fetchText(url, options)`.
- Produces: `collectDueSources({ sources, sourceState, fetchText, now }): Promise<{ successes, failures, skipped }>`.
- A success is `{ source, events, checkedAt }`; a failure is `{ source, message, checkedAt }`.

- [ ] **Step 1: Write failing tests for due selection and isolation**

Create three fake sources: a 15-minute source due now, a 60-minute source checked ten minutes ago, and a due source whose adapter throws. Assert one success, one skip and one failure, with no global rejection.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/collector.test.mjs`

Expected: FAIL because `collectDueSources` is missing.

- [ ] **Step 3: Implement bounded parallel collection**

Use `Promise.allSettled` over due sources and an adapter registry:

```js
const DIRECT_ADAPTERS = {
  mapado: parseMapado,
  "theatre-lorient": parseTheatreLorient,
  hydrophone: parseHydrophone,
  trios: parseTrios,
  fil: parseFil,
};
```

For `tourism` and `lorient-events`, call `parseTourismCandidates` or `parseLorientEventsCandidates`, then fetch each due candidate detail and call `resolveReservation`. Limit detail-page resolution to five concurrent requests with a small internal worker queue. Cache candidate detail results in state for six hours; direct ticket sources are always read when due.

- [ ] **Step 4: Test a partial detail failure**

Assert that one broken candidate detail becomes a failure attached to its source while successfully resolved candidates from other sources remain available. Never turn a detail-fetch error into `events: []`.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/collector.mjs test/collector.test.mjs
git commit -m "feat: collect event sources independently"
```

---

### Task 6: Cross-source deduplication

**Files:**
- Create: `src/dedupe.mjs`
- Test: `test/dedupe.test.mjs`

**Interfaces:**
- Consumes: valid `Event[]` and `canonicalEventId`.
- Produces: `deduplicateEvents(events): CanonicalEvent[]`.
- `CanonicalEvent` extends `Event` with `sourceIds: string[]` and `sourceUrls: string[]`.

- [ ] **Step 1: Write failing duplicate tests**

Use the same date and venue with titles `Emily Loizeau & Quatuor Debussy` and `EMILY LOIZEAU + QUATUOR DEBUSSY`. Assert one canonical event, both sources recorded, and the direct Theatre booking URL preferred over the Tourism detail URL. Assert different dates never merge.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/dedupe.test.mjs`

Expected: FAIL because `deduplicateEvents` is missing.

- [ ] **Step 3: Implement deterministic matching**

Normalize `&` and `+` to `et`, remove organizer prefixes and punctuation, map venue aliases (`Grand Théâtre` → `Théâtre de Lorient`, `Salle Keragan` → `Océanis`) and require exact local date plus city. Merge titles when their normalized token intersection divided by the smaller token count is at least `0.85`.

Prefer booking hosts in this order: official venue domain, Mapado/Vostickets, official festival ticketing, territorial detail page. When uncertain, retain two events.

- [ ] **Step 4: Add false-merge protection tests**

Assert that `Présentation de saison` at two different venues, two different shows on one date, and similar festival names in different communes stay separate.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/dedupe.mjs test/dedupe.test.mjs
git commit -m "feat: deduplicate events across official sources"
```

---

### Task 7: Strict persistent state and incident lifecycle

**Files:**
- Create: `src/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Produces: `emptyState(): MonitorState`, `validateState(value): MonitorState`, `applyCollection({ state, successes, failures, now }): Transition`.
- `Transition` is `{ state, newEvents, incidents, recoveries, initializedSources }`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover these exact cases:

1. A new source silently baselines its current events.
2. A later event becomes `newEvents` and enters `seen` only after successful notification acknowledgement.
3. Three failures do not alert; the fourth produces one incident; later failures do not repeat it.
4. First success after an incident produces one recovery.
5. One source's failure does not baseline or clear that source.
6. `{}`, a future version, inconsistent timestamps and foreign URLs are rejected.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/state.test.mjs`

Expected: FAIL because `src/state.mjs` is missing.

- [ ] **Step 3: Implement version 1 state**

```js
export function emptyState() {
  return {
    version: 1,
    initializedAt: null,
    updatedAt: null,
    seen: {},
    sources: {},
    candidates: {},
  };
}
```

Each source record is `{ initializedAt, lastSuccessAt, lastCheckedAt, consecutiveFailures, incidentOpen }`. Each seen record is `{ title, startsOn, venue, city, bookingUrl, notifiedAt, sourceIds }`. Validation checks exact types, ISO timestamps, HTTPS URLs, known source IDs and lifecycle consistency.

- [ ] **Step 4: Separate transition from notification acknowledgement**

Implement `planTransition` without mutating state and `acknowledgeNotifications(transition, successfulIds, now)` so a failed ntfy call leaves only failed canonical IDs unrecorded and retryable.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/state.mjs test/state.test.mjs
git commit -m "feat: persist event and source health state"
```

---

### Task 8: Individual and grouped ntfy messages

**Files:**
- Create: `src/notifications.mjs`
- Create: `src/network.mjs`
- Test: `test/notifications.test.mjs`
- Test: `test/network.test.mjs`

**Interfaces:**
- Produces: `buildEventNotifications(events): Notification[]`, `buildHealthNotifications(incidents, recoveries): Notification[]`, `sendNtfy({ topic, notification, fetchImpl, timeoutMs }): Promise<void>`.
- `Notification` is `{ ids, title, message, clickUrl, priority, tags, markdown }`.

- [ ] **Step 1: Write failing message-shape tests**

Assert one event yields one notification, two yield two, and three yield one digest containing all titles, dates, venues and Markdown links. Generate twelve long events and assert the UTF-8 body stays at or below 4,096 bytes and ends with `… et N autres événements` plus a source link.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/notifications.test.mjs`

Expected: FAIL because notification builders are missing.

- [ ] **Step 3: Implement deterministic notification composition**

Individual title: `Nouvelle sortie près de Lorient`. Digest title: `<N> nouvelles sorties dans l'agglomération`. Format dates with `Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "Europe/Paris" })`. Use priority `4`, tags `ticket` and `performing_arts`, and `markdown: true`.

- [ ] **Step 4: Write failing ntfy security and timeout tests**

Assert JSON POST to `https://ntfy.sh/<topic>`, `markdown: true`, response-status handling without topic leakage, rejection of a topic outside `/^[-_A-Za-z0-9]{24,64}$/`, and abortion after a 5 ms test timeout.

- [ ] **Step 5: Implement bounded ntfy publication**

```js
export async function sendNtfy({ topic, notification, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (!/^[-_A-Za-z0-9]{24,64}$/.test(topic ?? "")) throw new Error("Sujet ntfy absent ou invalide");
  const response = await fetchImpl(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      title: notification.title,
      message: notification.message,
      click: notification.clickUrl,
      priority: notification.priority,
      tags: notification.tags,
      markdown: notification.markdown,
    }),
  });
  if (!response.ok) throw new Error(`Notification ntfy refusée (HTTP ${response.status})`);
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/notifications.mjs src/network.mjs test/notifications.test.mjs test/network.test.mjs
git commit -m "feat: compose and publish Lorient event alerts"
```

---

### Task 9: CLI orchestration and retry-safe state writes

**Files:**
- Create: `scripts/run-monitor.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes all prior modules.
- Produces CLI modes `inspect`, `check --state <path>` and `test-notification`.

- [ ] **Step 1: Write failing end-to-end CLI tests with fixture routing**

Provide `EVENT_FIXTURE_DIR` and fake fetch routing so tests never access the internet. Assert:

- `inspect` needs no ntfy secret, prints each source status and canonical event count, and writes nothing;
- first `check` creates a valid state and sends no event notification;
- second unchanged `check` leaves the state byte-identical;
- a new fixture event triggers one fake ntfy call and then no duplicate;
- malformed state fails before source fetching;
- a failed notification remains retryable without losing successfully notified peers;
- neither stdout nor stderr contains the test topic.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/cli.test.mjs`

Expected: FAIL because the CLI is missing.

- [ ] **Step 3: Implement modes and atomic state writing**

Read state before collection and validate it immediately. Write changes to `<state>.tmp`, then rename to the requested state path. In `inspect`, print `OK`, `IGNORÉ (pas encore dû)` or `ERREUR` for every configured source. In `check`, process successes even when some sources fail, but set a non-zero exit only after state and successful notification acknowledgements are saved.

- [ ] **Step 4: Implement the explicit test notification**

Use title `Alertes sorties Lorient`, message `Surveillance des concerts et spectacles opérationnelle`, and click URL to the Tourism agenda. This mode does not read or write monitor state.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add scripts/run-monitor.mjs test/cli.test.mjs
git commit -m "feat: orchestrate event monitoring commands"
```

---

### Task 10: Scheduled workflows and operational documentation

**Files:**
- Create: `.github/workflows/monitor.yml`
- Create: `.github/workflows/heartbeat.yml`
- Create: `test/workflow.test.mjs`
- Create: `README.md`

**Interfaces:**
- Workflow dispatch input: `mode = check | inspect | test-notification`.
- State branch path: `.monitor-state/state.json`.
- Secret: `NTFY_TOPIC` available only to the monitor execution step.

- [ ] **Step 1: Write failing workflow structure tests**

Assert cron `7,22,37,52 * * * *` (every fifteen minutes away from the top of the hour), dispatch modes, concurrency without cancellation, `contents: write`, Node 22, job timeout 10 minutes, pinned full action SHAs, app checkout without persisted credentials, state checkout after tests, secret scoped only to `Run monitor`, and persistence guarded by a successful state checkout.

Assert heartbeat cron `17 3 1 * *`, job timeout 5 minutes and update of `monitor-heartbeat.txt` on `main`.

- [ ] **Step 2: Run workflow tests and verify failure**

Run: `node --test test/workflow.test.mjs`

Expected: FAIL because workflow files are missing.

- [ ] **Step 3: Implement monitor workflow**

Pin `actions/checkout` to `3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`) and `actions/setup-node` to `820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`). Run `npm ci`, `npm test`, then the selected mode. Persist state with the GitHub bot identity and only commit when `state.json` changed. Keep `Persist state` under `always()` so partial notification/source failures retain safe progress, while also requiring `steps.state-checkout.outcome == 'success'`.

- [ ] **Step 4: Implement monthly heartbeat**

Write an ISO UTC timestamp to `monitor-heartbeat.txt`, commit, rebase on `origin/main`, and push. Use its own concurrency group.

- [ ] **Step 5: Document real operation and limits**

README sections must include: covered sources, 15/60-minute polling, first-run baseline, digest rule, source incident behavior, public ntfy-topic warning, commands, state schema/branch bootstrap, adding/disabling a source, annual URL changes for FIL/Hydrophone, at-least-once duplicate window, GitHub schedule delay, and no purchase/resale behavior.

- [ ] **Step 6: Run full verification and commit**

Run:

```bash
npm test
git diff --check
for file in src/*.mjs src/adapters/*.mjs scripts/*.mjs test/*.mjs; do node --check "$file"; done
```

Expected: all tests PASS, no whitespace errors, all modules parse.

```bash
git add .github/workflows/monitor.yml .github/workflows/heartbeat.yml test/workflow.test.mjs README.md
git commit -m "ci: schedule Lorient event monitoring"
```

---

### Task 11: Live source audit and activation gate

**Files:**
- Modify: `src/sources.mjs`
- Modify: `README.md`
- Create: `docs/source-audit.md`
- Test: `test/live-contract.test.mjs`

**Interfaces:**
- Produces a source audit row: `{ id, reachable, signatureValid, eventCount, reservableCount, activated, reason }`.

- [ ] **Step 1: Run read-only live inspection**

Run: `node scripts/run-monitor.mjs inspect`

Expected: all twelve configured sources are listed. The six Mapado sites must validate. Each other source is activated only if its official signature and booking extraction are both demonstrably correct.

- [ ] **Step 2: Record exact evidence and disable ambiguous direct adapters**

Create `docs/source-audit.md` with one row per source, the checked URL, date, detected count and activation reason. `Le City` remains covered through the territorial agenda because no stable independent official online ticket catalogue was identified in the design research. A source that is reachable but not safely extractable stays in `SOURCES` with `enabled: false` and a concrete `disabledReason`; `inspect` must display that reason.

- [ ] **Step 3: Add opt-in live contract test**

`test/live-contract.test.mjs` skips unless `LIVE_TESTS=1`. When enabled, it fetches every active source, asserts its signature and validates all returned events without sending ntfy or writing state.

- [ ] **Step 4: Run local and live verification**

Run:

```bash
npm test
LIVE_TESTS=1 node --test test/live-contract.test.mjs
node scripts/run-monitor.mjs inspect
```

Expected: unit suite PASS; every active source passes the live contract; inspect reports explicit status for all sources.

- [ ] **Step 5: Commit the audited activation set**

```bash
git add src/sources.mjs README.md docs/source-audit.md test/live-contract.test.mjs
git commit -m "docs: audit live Lorient event sources"
```

---

### Task 12: Public deployment and end-to-end verification

**Files:**
- Modify: `.agent/SHARED.md`
- Remote-only: GitHub repository, `state` branch, `state.json`, `NTFY_TOPIC` secret.

**Interfaces:**
- Repository: `simsam56/sorties-lorient-alertes` unless unavailable.
- State starts as the exact JSON returned by `emptyState()`.

- [ ] **Step 1: Run pre-publication verification**

Run:

```bash
npm test
LIVE_TESTS=1 node --test test/live-contract.test.mjs
node scripts/run-monitor.mjs inspect
git diff --check
git status --short
```

Expected: tests and live contracts PASS; inspect has no unexplained failures; worktree is clean.

- [ ] **Step 2: Obtain explicit external-write authorization if it is no longer current**

Confirm that Simon still authorizes creation of a public repository, GitHub secret, state branch, workflow runs and one ntfy control notification. Do not infer this authorization from approval of the design alone.

- [ ] **Step 3: Create and push the public repository**

```bash
gh repo create simsam56/sorties-lorient-alertes --public --source=. --remote=origin --push
```

Expected: repository URL `https://github.com/simsam56/sorties-lorient-alertes` and `main` tracking `origin/main`.

- [ ] **Step 4: Bootstrap the state branch**

Create `state` from the current `main` SHA with the GitHub refs API, then create `state.json` from `emptyState()` on that branch. Read it back through the GitHub contents API and validate it locally before launching the workflow.

- [ ] **Step 5: Generate and subscribe to the new ntfy topic**

Generate 24 random bytes as a 48-character hexadecimal suffix and prefix it with `sorties-lorient-`. Show the resulting topic once to Simon so he can subscribe in ntfy. Wait for his confirmation before sending any test. Store it interactively with:

```bash
gh secret set NTFY_TOPIC --repo simsam56/sorties-lorient-alertes
```

Never place the topic in a command argument, file, commit or public log.

- [ ] **Step 6: Initialize the silent baseline**

Dispatch `mode=check`, watch it to completion, and inspect `state.json`. Expected: tests PASS, each successful source receives `initializedAt`, all current canonical events are in `seen`, and no event notification is sent.

- [ ] **Step 7: Verify the GitHub-to-ntfy path**

Dispatch `mode=test-notification`, watch the run, and ask Simon to confirm receipt of `Surveillance des concerts et spectacles opérationnelle`.

- [ ] **Step 8: Prove no duplicate on an unchanged run**

Record the state commit SHA, dispatch a second `mode=check`, and verify `0 nouvelle sortie notifiée`, unchanged `seen`, and no new state commit unless source health or due timestamps legitimately changed. State metadata-only changes must not produce ntfy messages.

- [ ] **Step 9: Verify heartbeat and scheduled activation**

Dispatch `heartbeat.yml`, confirm its default-branch commit, pull it locally with `git pull --ff-only`, and confirm both workflows are active. Verify a scheduled run when GitHub has executed the first 15-minute cron; do not mistake a manual run for proof of scheduling.

- [ ] **Step 10: Close shared state and perform final verification**

Remove the Codex line under `## En cours`, append the deployment URL and verified counts under `## Etat`, commit and push. Then run:

```bash
npm test
git diff --check
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
gh workflow list --repo simsam56/sorties-lorient-alertes
gh run list --repo simsam56/sorties-lorient-alertes --workflow monitor.yml --limit 5
```

Expected: clean synchronized repository, active workflows and latest monitor runs successful.
