import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeJsonAtomically } from "../src/state-file.mjs";

test("des écritures concurrentes utilisent chacune leur temporaire et laissent un JSON complet", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sorties-atomic-"));
  const statePath = join(directory, "state.json");
  const values = Array.from({ length: 12 }, (_, index) => ({ writer: index, payload: "x".repeat(10_000) }));

  try {
    const results = await Promise.allSettled(values.map((value) => writeJsonAtomically(statePath, value)));
    const stored = JSON.parse(await readFile(statePath, "utf8"));
    const leftovers = (await readdir(directory)).filter((name) => name.startsWith("state.json.tmp-"));

    assert.ok(results.every(({ status }) => status === "fulfilled"));
    assert.ok(values.some(({ writer }) => writer === stored.writer));
    assert.equal(stored.payload, "x".repeat(10_000));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
