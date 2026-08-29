import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SOURCES, getSource } from "../src/sources.mjs";
import { validateState } from "../src/state.mjs";

const projectRoot = new URL("..", import.meta.url);
const fixtureRoot = new URL("fixtures/", import.meta.url);
const topic = "test_topic_secret_1234567890";
const routesFile = "routes.json";
const requestsFile = "requests.jsonl";

function runCli({ args, fixtureDirectory, now, ntfyTopic = topic }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/run-monitor.mjs", ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        EVENT_FIXTURE_DIR: fixtureDirectory,
        EVENT_NOW: now,
        NTFY_TOPIC: ntfyTopic,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function defaultRoutes() {
  const routes = {};
  for (const source of SOURCES) {
    if (source.adapter === "mapado") routes[source.url] = "mapado.html";
    else if (source.adapter === "tourism") routes[source.url] = "tourism-list.html";
    else if (source.adapter === "lorient-events") routes[source.url] = "lorient-events-list.html";
    else routes[source.url] = `${source.adapter}.html`;
  }
  routes["https://www.lorientbretagnesudtourisme.fr/fr/fiche/fete-des-lumieres/"] = "tourism-detail.html";
  routes["https://lorient-evenements.bzh/agenda/le-grand-soir/"] = "lorient-events-detail.html";
  return routes;
}

async function createFixtureDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  for (const name of [
    "fil.html",
    "hydrophone.html",
    "lorient-events-detail.html",
    "lorient-events-list.html",
    "mapado.html",
    "theatre-lorient.html",
    "tourism-detail.html",
    "tourism-list.html",
    "trios.html",
  ]) {
    await cp(new URL(name, fixtureRoot), join(directory, name));
  }
  const filPath = join(directory, "fil.html");
  const filHtml = await readFile(filPath, "utf8");
  await writeFile(filPath, filHtml.replaceAll("2099", "2026").replace("8 août", "8 septembre"));
  await configureFixtures(directory);
  return directory;
}

async function configureFixtures(directory, overrides = {}) {
  const configuration = {
    routes: defaultRoutes(),
    ntfyStatuses: [],
    ...overrides,
  };
  await writeFile(join(directory, routesFile), `${JSON.stringify(configuration, null, 2)}\n`);
}

async function resetRequests(directory) {
  await writeFile(join(directory, requestsFile), "");
}

async function requests(directory) {
  try {
    return (await readFile(join(directory, requestsFile), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function addHydrophoneEvents(directory, events) {
  const path = join(directory, "hydrophone.html");
  const html = await readFile(path, "utf8");
  const cards = events.map(({ slug, title, date }) => `
    <article>
      <h2><a href="${slug}.html">${title}</a></h2>
      <p class="date">${date}</p>
      <p class="place">Hydrophone, Lorient</p>
      <a href="https://billetterie.hydrophone.fr/evenement/${slug}">Réserver</a>
    </article>`).join("");
  await writeFile(path, html.replace("</main>", `${cards}\n  </main>`));
}

function assertTopicIsPrivate(...results) {
  const output = results.map(({ stdout, stderr }) => `${stdout}${stderr}`).join("");
  assert.doesNotMatch(output, new RegExp(topic));
}

test("inspect contrôle toutes les sources sans secret, déduplique et ne touche aucun état", async () => {
  const directory = await createFixtureDirectory("sorties-inspect-");
  const statePath = join(directory, "inspect-state.json");
  try {
    const result = await runCli({
      args: ["inspect", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
      ntfyTopic: "",
    });

    assert.equal(result.code, 0, result.stderr);
    for (const source of SOURCES) {
      assert.match(result.stdout, new RegExp(`${source.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} — OK`, "u"));
    }
    assert.match(result.stdout, /Événements canoniques : 6/u);
    assert.equal(await exists(statePath), false);
    assert.equal(await exists(`${statePath}.tmp`), false);
    assert.deepEqual((await requests(directory)).filter(({ kind }) => kind === "ntfy"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("check crée une baseline silencieuse puis laisse l'état inchangé octet pour octet", async () => {
  const directory = await createFixtureDirectory("sorties-baseline-");
  const statePath = join(directory, "state.json");
  try {
    const first = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    const initialBytes = await readFile(statePath, "utf8");
    const state = validateState(JSON.parse(initialBytes));
    const second = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(Object.keys(state.sources).length, SOURCES.length);
    assert.equal(Object.keys(state.candidates).length, 2);
    assert.ok(Object.values(state.seen).every(({ notifiedAt }) => notifiedAt === null));
    assert.equal(await readFile(statePath, "utf8"), initialBytes);
    assert.equal(await exists(`${statePath}.tmp`), false);
    assert.deepEqual((await requests(directory)).filter(({ kind }) => kind === "ntfy"), []);
    assertTopicIsPrivate(first, second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("une nouveauté produit une notification acquittée une seule fois", async () => {
  const directory = await createFixtureDirectory("sorties-new-event-");
  const statePath = join(directory, "state.json");
  try {
    const baseline = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    await addHydrophoneEvents(directory, [{
      slug: "nouveau-concert",
      title: "Nouveau concert",
      date: "Dimanche 15 novembre 2099 à 20h30",
    }]);
    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [200] });
    await resetRequests(directory);

    const detected = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:15:00.000Z",
    });
    const notifiedRequests = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [500] });
    await resetRequests(directory);
    const unchanged = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:30:00.000Z",
    });

    assert.equal(baseline.code, 0, baseline.stderr);
    assert.equal(detected.code, 0, detected.stderr);
    assert.equal(unchanged.code, 0, unchanged.stderr);
    assert.equal(notifiedRequests.length, 1);
    assert.equal(JSON.parse(notifiedRequests[0].body).title, "Nouvelle sortie près de Lorient");
    assert.deepEqual((await requests(directory)).filter(({ kind }) => kind === "ntfy"), []);
    assertTopicIsPrivate(baseline, detected, unchanged);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("un état mal formé échoue avant toute récupération et reste intact", async () => {
  const directory = await createFixtureDirectory("sorties-invalid-state-");
  const statePath = join(directory, "state.json");
  const invalidBytes = "{\"version\":1}\n";
  try {
    await writeFile(statePath, invalidBytes);
    const result = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /État invalide/u);
    assert.equal(await readFile(statePath, "utf8"), invalidBytes);
    assert.equal(await exists(`${statePath}.tmp`), false);
    assert.deepEqual(await requests(directory), []);
    assertTopicIsPrivate(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("un lot partiel persiste santé, cache et acquittements puis retente seulement le pair échoué", async () => {
  const directory = await createFixtureDirectory("sorties-partial-");
  const statePath = join(directory, "state.json");
  const theatre = getSource("theatre-lorient");
  try {
    const baseline = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    const baselineState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    await addHydrophoneEvents(directory, [
      { slug: "pair-reussi", title: "Pair réussi", date: "Dimanche 15 novembre 2099 à 20h30" },
      { slug: "pair-a-retenter", title: "Pair à retenter", date: "Lundi 16 novembre 2099 à 20h30" },
    ]);
    const partialRoutes = defaultRoutes();
    partialRoutes[theatre.url] = { status: 503, body: "indisponible" };
    await configureFixtures(directory, { routes: partialRoutes, ntfyStatuses: [200, 503] });
    await resetRequests(directory);

    const partial = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:15:00.000Z",
    });
    const partialRequests = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const partialState = validateState(JSON.parse(await readFile(statePath, "utf8")));

    assert.notEqual(partial.code, 0);
    assert.equal(partialRequests.length, 2);
    assert.equal(partialState.sources[theatre.id].consecutiveFailures, 1);
    assert.equal(partialState.sources[theatre.id].lastCheckedAt, "2026-08-30T10:15:00.000Z");
    assert.deepEqual(partialState.candidates, baselineState.candidates);
    assert.ok(partialState.seen["2099-11-15:lorient:hydrophone:pair-reussi"]);
    assert.equal(partialState.seen["2099-11-16:lorient:hydrophone:pair-a-retenter"], undefined);
    assert.equal(await exists(`${statePath}.tmp`), false);

    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [200] });
    await resetRequests(directory);
    const retry = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:30:00.000Z",
    });
    const retryRequests = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const retryState = validateState(JSON.parse(await readFile(statePath, "utf8")));

    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(retryRequests.length, 1);
    assert.match(JSON.parse(retryRequests[0].body).message, /Pair à retenter/u);
    assert.ok(retryState.seen["2099-11-16:lorient:hydrophone:pair-a-retenter"]);
    assert.equal(retryState.sources[theatre.id].consecutiveFailures, 0);
    assertTopicIsPrivate(baseline, partial, retry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("test-notification envoie le message explicite sans lire ni écrire l'état", async () => {
  const directory = await createFixtureDirectory("sorties-test-notification-");
  const statePath = join(directory, "state.json");
  const stateBytes = "état volontairement invalide\n";
  try {
    await writeFile(statePath, stateBytes);
    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [200] });
    await resetRequests(directory);
    const result = await runCli({
      args: ["test-notification", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    const ntfyRequests = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const payload = JSON.parse(ntfyRequests[0].body);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(ntfyRequests.length, 1);
    assert.deepEqual(payload, {
      title: "Alertes sorties Lorient",
      message: "Surveillance des concerts et spectacles opérationnelle",
      click: getSource("tourism").homeUrl,
      priority: 3,
      tags: ["white_check_mark"],
      markdown: false,
    });
    assert.equal(await readFile(statePath, "utf8"), stateBytes);
    assert.equal(await exists(`${statePath}.tmp`), false);
    assertTopicIsPrivate(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
