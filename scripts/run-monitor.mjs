import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { collectDueSources } from "../src/collector.mjs";
import { deduplicateEvents } from "../src/dedupe.mjs";
import { fetchSourceText, sendNtfy } from "../src/network.mjs";
import { buildEventNotifications, buildHealthNotifications } from "../src/notifications.mjs";
import { SOURCES, getSource } from "../src/sources.mjs";
import { migrateCanonicalEventKeys } from "../src/canonical-keys.mjs";
import { writeJsonAtomically } from "../src/state-file.mjs";
import {
  acknowledgeHealthNotifications,
  acknowledgeNotifications,
  planTransition,
  validateState,
} from "../src/state.mjs";

const FIXTURE_ROUTES_FILE = "routes.json";
const FIXTURE_REQUESTS_FILE = "requests.jsonl";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestedStatePath(args) {
  const flagIndex = args.indexOf("--state");
  return flagIndex === -1 ? undefined : args[flagIndex + 1];
}

function requiresExistingState(args) {
  return args.includes("--require-existing-state");
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

    await appendFixtureRequest(directory, {
      kind: "source",
      url: parsedUrl.href,
      headers: options.headers,
    });
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

async function loadState(path, { requireExisting = false } = {}) {
  let bytes;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && !requireExisting) {
      return { state: validateState(undefined), exists: false };
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new Error("État invalide: JSON illisible");
  }
  const prepared = parsed?.seen && parsed?.outbox?.events
    ? migrateCanonicalEventKeys(parsed)
    : parsed;
  return { state: validateState(prepared), exists: true };
}
