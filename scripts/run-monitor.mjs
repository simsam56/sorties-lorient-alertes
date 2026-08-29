import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { collectDueSources } from "../src/collector.mjs";
import { deduplicateEvents } from "../src/dedupe.mjs";
import { sendNtfy } from "../src/network.mjs";
import { buildEventNotifications, buildHealthNotifications } from "../src/notifications.mjs";
import { SOURCES, getSource } from "../src/sources.mjs";
import { acknowledgeNotifications, planTransition, validateState } from "../src/state.mjs";

const FIXTURE_ROUTES_FILE = "routes.json";
const FIXTURE_REQUESTS_FILE = "requests.jsonl";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestedStatePath(args) {
  const flagIndex = args.indexOf("--state");
  return flagIndex === -1 ? undefined : args[flagIndex + 1];
}

function executionDate(environment) {
  const value = environment.EVENT_NOW;
  const now = value ? new Date(value) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("EVENT_NOW invalide");
  return now;
}

async function appendFixtureRequest(directory, request) {
  await appendFile(join(directory, FIXTURE_REQUESTS_FILE), `${JSON.stringify(request)}\n`, "utf8");
}

function fixtureBodyPath(directory, file) {
  const root = resolve(directory);
  const path = resolve(root, file);
  if (path !== root && !path.startsWith(`${root}/`)) throw new Error("Route de fixture invalide");
  return path;
}

async function createFixtureFetch(directory) {
  const configuration = JSON.parse(await readFile(join(directory, FIXTURE_ROUTES_FILE), "utf8"));
  const routes = configuration?.routes;
  const ntfyStatuses = configuration?.ntfyStatuses ?? [];
  if (!routes || typeof routes !== "object" || Array.isArray(routes) || !Array.isArray(ntfyStatuses)) {
    throw new Error("Configuration de fixtures invalide");
  }
  let ntfyIndex = 0;

  return async (url, options = {}) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "ntfy.sh" && (options.method ?? "GET") === "POST") {
      const status = ntfyStatuses[ntfyIndex] ?? 200;
      ntfyIndex += 1;
      await appendFixtureRequest(directory, { kind: "ntfy", body: options.body });
      return new Response("", { status });
    }

    await appendFixtureRequest(directory, { kind: "source", url: parsedUrl.href });
    const route = routes[parsedUrl.href];
    if (route === undefined) throw new Error(`Route de fixture absente: ${parsedUrl.href}`);
    const specification = typeof route === "string" ? { file: route, status: 200 } : route;
    if (!specification || typeof specification !== "object" || Array.isArray(specification)) {
      throw new Error(`Route de fixture invalide: ${parsedUrl.href}`);
    }
    const status = specification.status ?? 200;
    const body = specification.file
      ? await readFile(fixtureBodyPath(directory, specification.file), "utf8")
      : String(specification.body ?? "");
    return new Response(body, { status });
  };
}

async function networkFetch(environment) {
  return environment.EVENT_FIXTURE_DIR
    ? createFixtureFetch(environment.EVENT_FIXTURE_DIR)
    : fetch;
}

async function fetchText(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`Lecture de source refusée (HTTP ${response.status})`);
  return response.text();
}

async function loadState(path) {
  let bytes;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { state: validateState(undefined), exists: false };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new Error("État invalide: JSON illisible");
  }
  return { state: validateState(parsed), exists: true };
}

async function writeStateAtomically(path, state) {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

async function collect({ state, now, fetchImpl }) {
  const sourceState = Object.fromEntries(
    Object.entries(state?.sources ?? {}).map(([id, record]) => [id, record.lastCheckedAt]),
  );
  return collectDueSources({
    sources: SOURCES,
    sourceState,
    candidateState: state?.candidates ?? {},
    fetchText: (url, options) => fetchText(fetchImpl, url, options),
    now,
  });
}

function canonicalSuccesses(collection) {
  const canonicalEvents = deduplicateEvents(collection.successes.flatMap(({ events }) => events));
  const successes = collection.successes.map((success) => ({
    ...success,
    events: canonicalEvents.filter(({ sourceIds }) => sourceIds.includes(success.source.id)),
  }));
  return { canonicalEvents, successes };
}

function printInspection(collection, canonicalEvents) {
  for (const source of SOURCES) {
    const success = collection.successes.find((entry) => entry.source.id === source.id);
    const failure = collection.failures.find((entry) => entry.source.id === source.id);
    const skipped = collection.skipped.find((entry) => entry.source.id === source.id);
    if (success) {
      console.log(`${source.name} — OK — ${success.events.length} événement(s)`);
    } else if (failure) {
      console.log(`${source.name} — ERREUR — ${failure.message}`);
    } else if (skipped?.reason === "not-due") {
      console.log(`${source.name} — IGNORÉ (pas encore dû)`);
    } else {
      const reason = source.disabledReason ? ` : ${source.disabledReason}` : "";
      console.log(`${source.name} — IGNORÉ (désactivée${reason})`);
    }
  }
  console.log(`Événements canoniques : ${canonicalEvents.length}`);
}

async function publishTransition({ transition, topic, fetchImpl, now }) {
  const eventNotifications = buildEventNotifications(transition.newEvents)
    .map((notification) => ({ kind: "event", notification }));
  const healthNotifications = buildHealthNotifications(transition.incidents, transition.recoveries)
    .map((notification) => ({ kind: "health", notification }));
  const successfulEventIds = [];
  const failures = [];

  for (const entry of [...eventNotifications, ...healthNotifications]) {
    try {
      await sendNtfy({ topic, notification: entry.notification, fetchImpl });
      if (entry.kind === "event") successfulEventIds.push(...entry.notification.ids);
    } catch (error) {
      failures.push({ title: entry.notification.title, message: errorMessage(error) });
    }
  }

  return {
    transition: acknowledgeNotifications(transition, successfulEventIds, now),
    failures,
    successfulEventIds,
  };
}

async function inspect(environment) {
  const now = executionDate(environment);
  const fetchImpl = await networkFetch(environment);
  const collection = await collect({ state: undefined, now, fetchImpl });
  const { canonicalEvents } = canonicalSuccesses(collection);
  printInspection(collection, canonicalEvents);
  return collection.failures.length > 0 ? 1 : 0;
}

async function check(args, environment) {
  const statePath = requestedStatePath(args);
  if (!statePath) throw new Error("Option --state obligatoire en mode check");

  // Cette validation précède volontairement toute création de client réseau.
  const loaded = await loadState(statePath);
  const now = executionDate(environment);
  const fetchImpl = await networkFetch(environment);
  const collection = await collect({ state: loaded.state, now, fetchImpl });
  const { successes } = canonicalSuccesses(collection);
  const planned = planTransition({
    state: loaded.state,
    successes,
    failures: collection.failures,
    candidateUpdates: collection.candidateUpdates,
    now,
  });
  const published = await publishTransition({
    transition: planned,
    topic: environment.NTFY_TOPIC,
    fetchImpl,
    now,
  });

  if (!loaded.exists || !isDeepStrictEqual(published.transition.state, loaded.state)) {
    await writeStateAtomically(statePath, published.transition.state);
  }

  console.log(
    `${successes.length} source(s) réussie(s), ${collection.failures.length} en erreur, ` +
    `${published.successfulEventIds.length} événement(s) notifié(s)`,
  );
  for (const failure of collection.failures) {
    console.error(`${failure.source.name} — ERREUR — ${failure.message}`);
  }
  for (const failure of published.failures) {
    console.error(`Notification « ${failure.title} » — ERREUR — ${failure.message}`);
  }
  return collection.failures.length > 0 || published.failures.length > 0 ? 1 : 0;
}

async function testNotification(environment) {
  const fetchImpl = await networkFetch(environment);
  await sendNtfy({
    topic: environment.NTFY_TOPIC,
    fetchImpl,
    notification: {
      ids: ["test"],
      title: "Alertes sorties Lorient",
      message: "Surveillance des concerts et spectacles opérationnelle",
      clickUrl: getSource("tourism").homeUrl,
      priority: 3,
      tags: ["white_check_mark"],
      markdown: false,
    },
  });
  console.log("Notification de contrôle envoyée");
  return 0;
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  const [mode = "check", ...args] = argv;
  if (mode === "inspect") return inspect(environment);
  if (mode === "check") return check(args, environment);
  if (mode === "test-notification") return testNotification(environment);
  throw new Error(`Mode inconnu: ${mode}`);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
