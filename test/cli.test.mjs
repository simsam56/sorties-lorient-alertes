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

async function addMapadoEvents(directory, events) {
  const path = join(directory, "mapado.html");
  const html = await readFile(path, "utf8");
  const additions = events.map(({ slug, title, date }, index) => ({
    title,
    type: "dated_events",
    isOnSale: true,
    availabilityStatus: "onSale",
    slug,
    venue: { name: "Hydrophone", city: "Lorient" },
    sellingDeviceSchedule: {
      [`/v1/selling_devices/test-${index}`]: { fr: date },
    },
  }));
  const marker = '"hydra:member": [';
  if (!html.includes(marker)) throw new Error("Fixture Mapado invalide");
  const serialized = JSON.stringify(additions, null, 2).slice(1, -1);
  await writeFile(path, html.replace(marker, `${marker}${serialized},`));
}

async function resetMapadoEvents(directory) {
  await cp(new URL("mapado.html", fixtureRoot), join(directory, "mapado.html"));
}

function assertTopicIsPrivate(...results) {
  const output = results.map(({ stdout, stderr }) => `${stdout}${stderr}`).join("");
  assert.doesNotMatch(output, new RegExp(topic));
}

function pendingHealthIds(state, kind, sourceId) {
  return Object.entries(state.outbox.health)
    .filter(([, pending]) => pending.kind === kind && pending.sourceId === sourceId)
    .map(([id]) => id);
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
      const status = source.enabled
        ? `${source.name} — OK`
        : `${source.name} — IGNORÉ (désactivée : ${source.disabledReason})`;
      assert.ok(result.stdout.includes(status), status);
    }
    assert.match(result.stdout, /Événements canoniques : 1/u);
    assert.equal(await exists(statePath), false);
    assert.equal(await exists(`${statePath}.tmp`), false);
    const recordedRequests = await requests(directory);
    assert.deepEqual(recordedRequests.filter(({ kind }) => kind === "ntfy"), []);
    for (const request of recordedRequests.filter(({ kind }) => kind === "source")) {
      assert.deepEqual(request.headers, {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "sorties-lorient-alertes-live-audit/1.0",
      });
    }
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
    assert.equal(Object.keys(state.sources).length, SOURCES.filter(({ enabled }) => enabled).length);
    assert.equal(Object.keys(state.candidates).length, 0);
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
    await addMapadoEvents(directory, [{
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

test("check requis refuse un état absent avant réseau, ntfy et écriture", async () => {
  const directory = await createFixtureDirectory("sorties-required-state-");
  const statePath = join(directory, "missing", "state.json");
  try {
    const result = await runCli({
      args: ["check", "--state", statePath, "--require-existing-state"],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ENOENT/u);
    assert.equal(await exists(statePath), false);
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
  const monitoredSource = getSource("mapado-estran");
  try {
    const baseline = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    const baselineState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    await addMapadoEvents(directory, [
      { slug: "pair-reussi", title: "Pair réussi", date: "Dimanche 15 novembre 2099 à 20h30" },
      { slug: "pair-a-retenter", title: "Pair à retenter", date: "Lundi 16 novembre 2099 à 20h30" },
    ]);
    const partialRoutes = defaultRoutes();
    partialRoutes[monitoredSource.url] = { status: 503, body: "indisponible" };
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
    assert.equal(partialState.sources[monitoredSource.id].consecutiveFailures, 1);
    assert.equal(partialState.sources[monitoredSource.id].lastCheckedAt, "2026-08-30T10:15:00.000Z");
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
    assert.equal(retryState.sources[monitoredSource.id].consecutiveFailures, 0);
    assertTopicIsPrivate(baseline, partial, retry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("une notification échouée reste dans l'outbox même si la source retire ensuite l'événement", async () => {
  const directory = await createFixtureDirectory("sorties-disappeared-");
  const statePath = join(directory, "state.json");
  const pendingId = "2099-11-15:lorient:hydrophone:concert-disparu";
  try {
    await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    await addMapadoEvents(directory, [{
      slug: "concert-disparu",
      title: "Concert disparu",
      date: "Dimanche 15 novembre 2099 à 20h30",
    }]);
    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [503] });
    await resetRequests(directory);

    const failed = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:15:00.000Z",
    });
    const failedState = validateState(JSON.parse(await readFile(statePath, "utf8")));

    assert.notEqual(failed.code, 0);
    assert.ok(failedState.outbox.events[pendingId]);
    assert.equal(failedState.seen[pendingId], undefined);

    await resetMapadoEvents(directory);
    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [200] });
    await resetRequests(directory);
    const retry = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:30:00.000Z",
    });
    const retryNtfy = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const retryState = validateState(JSON.parse(await readFile(statePath, "utf8")));

    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(retryNtfy.length, 1);
    assert.match(JSON.parse(retryNtfy[0].body).message, /Concert disparu/u);
    assert.equal(retryState.outbox.events[pendingId], undefined);
    assert.ok(retryState.seen[pendingId]);
    assertTopicIsPrivate(failed, retry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("une double collecte d'un événement pending conserve une seule entrée et un seul envoi par contrôle", async () => {
  const directory = await createFixtureDirectory("sorties-pending-twice-");
  const statePath = join(directory, "state.json");
  try {
    await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    await addMapadoEvents(directory, [{
      slug: "pending-unique",
      title: "Pending unique",
      date: "Dimanche 15 novembre 2099 à 20h30",
    }]);

    for (const now of ["2026-08-30T10:15:00.000Z", "2026-08-30T10:30:00.000Z"]) {
      await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [503] });
      await resetRequests(directory);
      const result = await runCli({ args: ["check", "--state", statePath], fixtureDirectory: directory, now });
      const ntfyRequests = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
      const state = validateState(JSON.parse(await readFile(statePath, "utf8")));

      assert.notEqual(result.code, 0);
      assert.equal(ntfyRequests.length, 1);
      assert.deepEqual(Object.keys(state.outbox.events), [
        "2099-11-15:lorient:hydrophone:pending-unique",
      ]);
      assertTopicIsPrivate(result);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("incident et récupération restent dans l'outbox jusqu'à leur acquittement ntfy", async () => {
  const directory = await createFixtureDirectory("sorties-health-outbox-");
  const statePath = join(directory, "state.json");
  const monitoredSource = getSource("mapado-estran");
  try {
    await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });
    const failedRoutes = defaultRoutes();
    failedRoutes[monitoredSource.url] = { status: 503, body: "indisponible" };

    for (const now of [
      "2026-08-30T10:15:00.000Z",
      "2026-08-30T10:30:00.000Z",
      "2026-08-30T10:45:00.000Z",
    ]) {
      await configureFixtures(directory, { routes: failedRoutes, ntfyStatuses: [] });
      await resetRequests(directory);
      const result = await runCli({ args: ["check", "--state", statePath], fixtureDirectory: directory, now });
      assert.notEqual(result.code, 0);
      assert.deepEqual((await requests(directory)).filter(({ kind }) => kind === "ntfy"), []);
    }

    await configureFixtures(directory, { routes: failedRoutes, ntfyStatuses: [503] });
    await resetRequests(directory);
    const fourth = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T11:00:00.000Z",
    });
    const fourthState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.notEqual(fourth.code, 0);
    assert.equal((await requests(directory)).filter(({ kind }) => kind === "ntfy").length, 1);
    assert.deepEqual(pendingHealthIds(fourthState, "incident", monitoredSource.id), [
      "incident:mapado-estran:2026-08-30T11:00:00.000Z",
    ]);

    await configureFixtures(directory, { routes: failedRoutes, ntfyStatuses: [200] });
    await resetRequests(directory);
    const fifth = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T11:15:00.000Z",
    });
    const fifthNtfy = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const fifthState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.notEqual(fifth.code, 0);
    assert.equal(fifthNtfy.length, 1);
    assert.match(JSON.parse(fifthNtfy[0].body).title, /Incident de surveillance/u);
    assert.deepEqual(pendingHealthIds(fifthState, "incident", monitoredSource.id), []);

    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [503] });
    await resetRequests(directory);
    const recoveryFailed = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T11:30:00.000Z",
    });
    const recoveryFailedState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.notEqual(recoveryFailed.code, 0);
    assert.deepEqual(pendingHealthIds(recoveryFailedState, "recovery", monitoredSource.id), [
      "recovery:mapado-estran:2026-08-30T11:30:00.000Z",
    ]);

    await configureFixtures(directory, { routes: defaultRoutes(), ntfyStatuses: [200] });
    await resetRequests(directory);
    const recoveryRetry = await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T11:45:00.000Z",
    });
    const recoveryNtfy = (await requests(directory)).filter(({ kind }) => kind === "ntfy");
    const recoveredState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.equal(recoveryRetry.code, 0, recoveryRetry.stderr);
    assert.equal(recoveryNtfy.length, 1);
    assert.match(JSON.parse(recoveryNtfy[0].body).title, /Surveillance rétablie/u);
    assert.deepEqual(recoveredState.outbox.health, {});
    assertTopicIsPrivate(fourth, fifth, recoveryFailed, recoveryRetry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plusieurs cycles santé non acquittés restent distincts et causalement ordonnés", async () => {
  const directory = await createFixtureDirectory("sorties-health-cycles-");
  const statePath = join(directory, "state.json");
  const monitoredSource = getSource("mapado-estran");
  const failedRoutes = defaultRoutes();
  failedRoutes[monitoredSource.url] = { status: 503, body: "indisponible" };

  const runWithNtfyFailure = async (now, routes) => {
    await configureFixtures(directory, { routes, ntfyStatuses: [503] });
    await resetRequests(directory);
    const result = await runCli({ args: ["check", "--state", statePath], fixtureDirectory: directory, now });
    return {
      result,
      ntfy: (await requests(directory)).filter(({ kind }) => kind === "ntfy"),
    };
  };

  try {
    await runCli({
      args: ["check", "--state", statePath],
      fixtureDirectory: directory,
      now: "2026-08-30T10:00:00.000Z",
    });

    for (const now of [
      "2026-08-30T10:15:00.000Z",
      "2026-08-30T10:30:00.000Z",
      "2026-08-30T10:45:00.000Z",
      "2026-08-30T11:00:00.000Z",
    ]) await runWithNtfyFailure(now, failedRoutes);

    const firstRecovery = await runWithNtfyFailure("2026-08-30T11:15:00.000Z", defaultRoutes());
    assert.equal(firstRecovery.ntfy.length, 1);
    assert.match(JSON.parse(firstRecovery.ntfy[0].body).title, /Incident de surveillance/u);

    for (const now of [
      "2026-08-30T11:30:00.000Z",
      "2026-08-30T11:45:00.000Z",
      "2026-08-30T12:00:00.000Z",
      "2026-08-30T12:15:00.000Z",
    ]) await runWithNtfyFailure(now, failedRoutes);

    const secondIncidentState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.deepEqual(Object.keys(secondIncidentState.outbox.health), [
      "incident:mapado-estran:2026-08-30T11:00:00.000Z",
      "recovery:mapado-estran:2026-08-30T11:15:00.000Z",
      "incident:mapado-estran:2026-08-30T12:15:00.000Z",
    ]);
    assert.deepEqual(Object.values(secondIncidentState.outbox.health).map(({ kind }) => kind), [
      "incident",
      "recovery",
      "incident",
    ]);

    const secondRecovery = await runWithNtfyFailure("2026-08-30T12:30:00.000Z", defaultRoutes());
    const secondRecoveryState = validateState(JSON.parse(await readFile(statePath, "utf8")));
    assert.notEqual(secondRecovery.result.code, 0);
    assert.equal(secondRecovery.ntfy.length, 1);
    assert.deepEqual(Object.keys(secondRecoveryState.outbox.health), [
      "incident:mapado-estran:2026-08-30T11:00:00.000Z",
      "recovery:mapado-estran:2026-08-30T11:15:00.000Z",
      "incident:mapado-estran:2026-08-30T12:15:00.000Z",
      "recovery:mapado-estran:2026-08-30T12:30:00.000Z",
    ]);
    assertTopicIsPrivate(firstRecovery.result, secondRecovery.result);
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
