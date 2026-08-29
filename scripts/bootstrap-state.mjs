import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { emptyState, validateState } from "../src/state.mjs";

function commandResult(command, args, cwd) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
}

async function git(args, cwd, allowedStatuses = [0]) {
  const result = await commandResult("git", args, cwd);
  if (!allowedStatuses.includes(result.status)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `code ${result.status}`;
    throw new Error(`git ${args.join(" ")} a échoué : ${detail}`);
  }
  return result;
}

async function cleanupBootstrap({ repository, temporaryRoot, worktree, branch }) {
  const errors = [];
  if (worktree) {
    try {
      await git(["worktree", "remove", "--force", worktree], repository);
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    const branchExists = await git(
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      repository,
      [0, 1],
    );
    if (branchExists.status === 0) await git(["branch", "-D", branch], repository);
  } catch (error) {
    errors.push(error);
  }

  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

export async function bootstrapState({ cwd = process.cwd(), remote = "origin" } = {}) {
  const repository = (await git(["rev-parse", "--show-toplevel"], cwd)).stdout.trim();
  const existing = await git(
    ["ls-remote", "--exit-code", "--heads", remote, "refs/heads/state"],
    repository,
    [0, 2],
  );
  if (existing.status === 0) {
    throw new Error(`${remote}/state existe déjà ; amorçage refusé avant création du worktree`);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "sorties-lorient-state-"));
  const worktree = join(temporaryRoot, "worktree");
  const branch = `bootstrap-state-${process.pid}-${randomUUID()}`;
  let worktreeAdded = false;
  let operationError;
  let result;

  try {
    await git(["worktree", "add", "--detach", worktree, "main"], repository);
    worktreeAdded = true;
    const initial = emptyState();
    await writeFile(join(worktree, "state.json"), `${JSON.stringify(initial, null, 2)}\n`, "utf8");
    await git(["switch", "--orphan", branch], worktree);
    await git(["add", "--", "state.json"], worktree);
    await git([
      "-c", "user.name=github-actions[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit", "-m", "chore: initialize monitor state",
    ], worktree);

    const tree = (await git(["ls-tree", "--name-only", "HEAD"], worktree)).stdout.trim();
    if (tree !== "state.json") throw new Error("Branche state invalide : fichiers inattendus");
    await git(["push", remote, "HEAD:refs/heads/state"], worktree);
    await git(["fetch", "--quiet", remote, "refs/heads/state"], repository);
    const remoteBytes = (await git(["show", "FETCH_HEAD:state.json"], repository)).stdout;
    const remoteState = validateState(JSON.parse(remoteBytes));
    if (!isDeepStrictEqual(remoteState, initial)) {
      throw new Error("État distant différent de l'état initial validé");
    }
    result = { remote, state: remoteState };
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = await cleanupBootstrap({
    repository,
    temporaryRoot,
    worktree: worktreeAdded ? worktree : null,
    branch,
  });
  if (operationError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        `${operationError.message} ; nettoyage incomplet : ${cleanupErrors.map(({ message }) => message).join(" ; ")}`,
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Nettoyage incomplet : ${cleanupErrors.map(({ message }) => message).join(" ; ")}`);
  }
  return result;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const { remote } = await bootstrapState();
    console.log(`État distant valide sur ${remote}/state ; ressources temporaires supprimées`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
