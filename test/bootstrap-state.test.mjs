import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { emptyState, validateState } from "../src/state.mjs";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BOOTSTRAP_SCRIPT = join(PROJECT_ROOT, "scripts", "bootstrap-state.mjs");

function execute(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function mustExecute(command, args, options = {}) {
  const result = execute(command, args, options);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} a échoué\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

async function createRepository(t) {
  const root = await mkdtemp(join(tmpdir(), "bootstrap-state-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  const remote = join(root, "origin.git");
  const bootstrapTmp = join(root, "bootstrap-tmp");
  await mkdir(bootstrapTmp);
  mustExecute("git", ["init", "--initial-branch=main", repository]);
  mustExecute("git", ["config", "user.name", "Bootstrap Test"], { cwd: repository });
  mustExecute("git", ["config", "user.email", "bootstrap@example.invalid"], { cwd: repository });
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  mustExecute("git", ["add", "README.md"], { cwd: repository });
  mustExecute("git", ["commit", "-m", "initial"], { cwd: repository });
  mustExecute("git", ["init", "--bare", remote]);
  mustExecute("git", ["remote", "add", "origin", remote], { cwd: repository });
  mustExecute("git", ["push", "-u", "origin", "main"], { cwd: repository });
  return { bootstrapTmp, remote, repository, root };
}

async function createOrphanResidueGitShim(root) {
  const shimDirectory = join(root, "git-shim");
  const shim = join(shimDirectory, "git");
  const realGit = mustExecute("which", ["git"]);
  await mkdir(shimDirectory);
  await writeFile(shim, `#!/bin/sh
"${realGit}" "$@"
status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi
if [ "$1" = "switch" ] && [ "$2" = "--orphan" ]; then
  printf inherited > inherited-from-main.txt
  "${realGit}" add -- inherited-from-main.txt
fi
exit 0
`, "utf8");
  await chmod(shim, 0o700);
  return shimDirectory;
}

function repositorySnapshot(repository) {
  return {
    branches: mustExecute(
      "git",
      ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"],
      { cwd: repository },
    ),
    head: mustExecute("git", ["rev-parse", "HEAD"], { cwd: repository }),
    worktrees: mustExecute("git", ["worktree", "list", "--porcelain"], { cwd: repository }),
  };
}

function remoteState(remote) {
  return execute("git", ["ls-remote", "--exit-code", "--heads", remote, "refs/heads/state"]);
}

test("refuse une branche state distante existante avant tout worktree ou commit", async (t) => {
  const { bootstrapTmp, repository, remote } = await createRepository(t);
  mustExecute("git", ["push", "origin", "main:state"], { cwd: repository });
  const before = repositorySnapshot(repository);
  const objectsBefore = mustExecute("git", ["count-objects", "-v"], { cwd: repository });
  const remoteBefore = remoteState(remote);
  assert.equal(remoteBefore.status, 0);
  const pushMarker = join(remote, "push-attempted");
  const hook = join(remote, "hooks", "pre-receive");
  await writeFile(hook, `#!/bin/sh
printf attempted > "${pushMarker}"
exit 1
`, "utf8");
  await chmod(hook, 0o700);

  const result = execute(process.execPath, [BOOTSTRAP_SCRIPT], {
    cwd: repository,
    env: { TMPDIR: bootstrapTmp },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin\/state existe déjà/u);
  assert.deepEqual(repositorySnapshot(repository), before);
  assert.equal(mustExecute("git", ["count-objects", "-v"], { cwd: repository }), objectsBefore);
  assert.equal(remoteState(remote).stdout, remoteBefore.stdout);
  assert.deepEqual(await readdir(bootstrapTmp), []);
  await assert.rejects(access(pushMarker), { code: "ENOENT" });
});

test("nettoie le worktree et la branche locale si le push échoue après création", async (t) => {
  const { bootstrapTmp, repository, remote } = await createRepository(t);
  const hook = join(remote, "hooks", "pre-receive");
  const pushMarker = join(remote, "push-attempted");
  await mkdir(dirname(hook), { recursive: true });
  await writeFile(hook, `#!/bin/sh
while read -r old_value new_value reference
do
  if [ "$reference" = "refs/heads/state" ]; then
    printf attempted > "${pushMarker}"
    echo "state push rejected" >&2
    exit 1
  fi
done
exit 0
`, "utf8");
  await chmod(hook, 0o700);
  const before = repositorySnapshot(repository);

  const result = execute(process.execPath, [BOOTSTRAP_SCRIPT], {
    cwd: repository,
    env: { TMPDIR: bootstrapTmp },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state push rejected/u);
  assert.equal(await readFile(pushMarker, "utf8"), "attempted");
  assert.deepEqual(repositorySnapshot(repository), before);
  assert.equal(remoteState(remote).status, 2);
  assert.deepEqual(await readdir(bootstrapTmp), []);
});

test("crée, valide et relit un état v2 distant puis retire ses ressources temporaires", async (t) => {
  const { bootstrapTmp, repository, remote, root } = await createRepository(t);
  const shimDirectory = await createOrphanResidueGitShim(root);
  const before = repositorySnapshot(repository);

  const result = execute(process.execPath, [BOOTSTRAP_SCRIPT], {
    cwd: repository,
    env: { PATH: `${shimDirectory}:${process.env.PATH}`, TMPDIR: bootstrapTmp },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /État distant valide/u);
  assert.deepEqual(repositorySnapshot(repository), before);
  assert.deepEqual(await readdir(bootstrapTmp), []);
  assert.equal(remoteState(remote).status, 0);
  assert.equal(
    mustExecute("git", [`--git-dir=${remote}`, "ls-tree", "--name-only", "state"]),
    "state.json",
  );
  const state = JSON.parse(
    mustExecute("git", [`--git-dir=${remote}`, "show", "state:state.json"]),
  );
  assert.deepEqual(validateState(state), emptyState());
});
