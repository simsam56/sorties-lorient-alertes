import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const SETUP_NODE_SHA = "820762786026740c76f36085b0efc47a31fe5020";

async function loadWorkflow(name) {
  const source = await readFile(join(PROJECT_ROOT, ".github", "workflows", name), "utf8");
  const workflow = parse(source);
  assert.equal(typeof workflow, "object");
  assert.ok(workflow);
  return workflow;
}

function findStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `Étape absente : ${name}`);
  return step;
}

function stringValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} a échoué\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

async function runWorkflowShell(script, cwd, environment = {}) {
  const scriptPath = join(await mkdtemp(join(tmpdir(), "workflow-shell-")), "step.sh");
  await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o700 });
  execute("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", scriptPath], {
    cwd,
    env: environment,
  });
}

async function initializeRemote(root, branch, files) {
  const remote = join(root, "origin.git");
  const checkout = join(root, "checkout");
  execute("git", ["init", "--bare", remote]);
  execute("git", ["clone", remote, checkout]);
  execute("git", ["switch", "-c", branch], { cwd: checkout });
  execute("git", ["config", "user.name", "Test Runner"], { cwd: checkout });
  execute("git", ["config", "user.email", "test@example.invalid"], { cwd: checkout });
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(checkout, name)), { recursive: true });
    await writeFile(join(checkout, name), contents, "utf8");
  }
  execute("git", ["add", "."], { cwd: checkout });
  execute("git", ["commit", "-m", "initial"], { cwd: checkout });
  execute("git", ["push", "-u", "origin", branch], { cwd: checkout });
  return { checkout, remote };
}

test("le workflow monitor sérialise les contrôles planifiés et manuels", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  assert.deepEqual(workflow.on.schedule, [{ cron: "7,22,37,52 * * * *" }]);
  assert.deepEqual(
    workflow.on.workflow_dispatch.inputs.mode.options,
    ["check", "inspect", "test-notification"],
  );
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.type, "choice");
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "check");
  assert.deepEqual(workflow.concurrency, {
    group: "monitor-state",
    queue: "max",
    "cancel-in-progress": false,
  });
  assert.deepEqual(workflow.permissions, { contents: "write" });

  const job = workflow.jobs.monitor;
  assert.equal(job["timeout-minutes"], 10);
  assert.equal(job["runs-on"], "ubuntu-latest");
});

test("le workflow monitor utilise Node 22 et des actions immuablement épinglées", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  const job = workflow.jobs.monitor;
  const appCheckout = findStep(job, "Checkout application");
  const setupNode = findStep(job, "Setup Node.js");
  const stateCheckout = findStep(job, "Checkout state");

  assert.equal(appCheckout.uses, `actions/checkout@${CHECKOUT_SHA}`);
  assert.equal(appCheckout.with.path, "app");
  assert.equal(appCheckout.with["persist-credentials"], false);
  assert.equal(setupNode.uses, `actions/setup-node@${SETUP_NODE_SHA}`);
  assert.equal(String(setupNode.with["node-version"]), "22");
  assert.equal(stateCheckout.uses, `actions/checkout@${CHECKOUT_SHA}`);
  assert.equal(stateCheckout.with.ref, "state");
  assert.equal(stateCheckout.with.path, ".monitor-state");

  const actionReferences = job.steps.filter((step) => step.uses).map((step) => step.uses);
  assert.ok(actionReferences.length > 0);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@]+@[0-9a-f]{40}$/);
  }
});

test("le checkout de l'état arrive après les tests et borne l'exécution du monitor", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  const job = workflow.jobs.monitor;
  const setupNode = findStep(job, "Setup Node.js");
  const install = findStep(job, "Install dependencies");
  const tests = findStep(job, "Run tests");
  const stateCheckout = findStep(job, "Checkout state");
  const runMonitor = findStep(job, "Run monitor");
  assert.equal(install.run, "npm ci");
  assert.equal(install["working-directory"], "app");
  assert.equal(tests.run, "npm test");
  assert.equal(tests["working-directory"], "app");
  assert.ok(job.steps.indexOf(install) > job.steps.indexOf(setupNode));
  assert.ok(job.steps.indexOf(tests) > job.steps.indexOf(install));
  assert.ok(job.steps.indexOf(stateCheckout) > job.steps.indexOf(tests));
  assert.ok(job.steps.indexOf(runMonitor) > job.steps.indexOf(stateCheckout));
  assert.equal(runMonitor["working-directory"], undefined);
  assert.equal(runMonitor.run.trim(), 'node app/scripts/run-monitor.mjs "$MODE" --state .monitor-state/state.json');
  assert.equal(
    runMonitor.env.MODE,
    "${{ github.event_name == 'workflow_dispatch' && inputs.mode || 'check' }}",
  );
});

test("NTFY_TOPIC n'est disponible que pendant l'exécution du monitor", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  const job = workflow.jobs.monitor;
  const runMonitor = findStep(job, "Run monitor");
  assert.equal(runMonitor.env.NTFY_TOPIC, "${{ secrets.NTFY_TOPIC }}");

  const otherConfiguration = {
    workflowEnv: workflow.env,
    jobEnv: job.env,
    steps: job.steps.filter((step) => step !== runMonitor),
  };
  assert.equal(stringValues(otherConfiguration).some((value) => value.includes("NTFY_TOPIC")), false);
  assert.equal(stringValues(otherConfiguration).some((value) => value.includes("secrets.")), false);
});

test("la persistance d'état est toujours tentée après un checkout réussi", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  const persist = findStep(workflow.jobs.monitor, "Persist state");
  assert.match(String(persist.if), /always\(\)/);
  assert.match(String(persist.if), /steps\.state-checkout\.outcome\s*==\s*'success'/);
  assert.equal(persist["working-directory"], ".monitor-state");
});

test("la persistance ne committe que les changements de state.json", async () => {
  const workflow = await loadWorkflow("monitor.yml");
  const persist = findStep(workflow.jobs.monitor, "Persist state");
  const root = await mkdtemp(join(tmpdir(), "monitor-state-"));
  const { checkout, remote } = await initializeRemote(root, "state", { "state.json": "{}\n" });
  const before = execute("git", ["rev-list", "--count", "state"], { cwd: checkout });

  await runWorkflowShell(persist.run, checkout, { GITHUB_SHA: "0123456789abcdef" });
  assert.equal(execute("git", ["rev-list", "--count", "state"], { cwd: checkout }), before);

  await writeFile(join(checkout, "state.json"), '{"version":2}\n', "utf8");
  await runWorkflowShell(persist.run, checkout, { GITHUB_SHA: "fedcba9876543210" });
  assert.equal(Number(execute("git", ["rev-list", "--count", "state"], { cwd: checkout })), Number(before) + 1);
  assert.equal(execute("git", [`--git-dir=${remote}`, "show", "state:state.json"]), '{"version":2}');
});

test("le heartbeat mensuel met à jour main avec un horodatage UTC", async () => {
  const workflow = await loadWorkflow("heartbeat.yml");
  const monitorWorkflow = await loadWorkflow("monitor.yml");
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 3 1 * *" }]);
  assert.equal(Object.hasOwn(workflow.on, "workflow_dispatch"), true);
  assert.deepEqual(workflow.permissions, { contents: "write" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.notEqual(workflow.concurrency.group, monitorWorkflow.concurrency.group);

  const job = workflow.jobs.heartbeat;
  assert.equal(job["timeout-minutes"], 5);
  const checkout = findStep(job, "Checkout main");
  assert.equal(checkout.uses, `actions/checkout@${CHECKOUT_SHA}`);
  assert.equal(checkout.with.ref, "main");
  const update = findStep(job, "Update heartbeat");

  const root = await mkdtemp(join(tmpdir(), "monitor-heartbeat-"));
  const repository = await initializeRemote(root, "main", { ".gitkeep": "" });
  await runWorkflowShell(update.run, repository.checkout);
  const heartbeat = await readFile(join(repository.checkout, "monitor-heartbeat.txt"), "utf8");
  assert.match(heartbeat, /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
  assert.equal(execute("git", [`--git-dir=${repository.remote}`, "show", "main:monitor-heartbeat.txt"]), heartbeat.trim());
});

const actionlintAvailable = spawnSync("actionlint", ["-version"], { encoding: "utf8" }).status === 0;

test("actionlint valide les workflows quand il est disponible", { skip: !actionlintAvailable }, () => {
  execute("actionlint", [".github/workflows/monitor.yml", ".github/workflows/heartbeat.yml"], {
    cwd: PROJECT_ROOT,
  });
});
