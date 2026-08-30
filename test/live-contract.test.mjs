import test from "node:test";
import assert from "node:assert/strict";

import { collectDueSources } from "../src/collector.mjs";
import { createEvent } from "../src/model.mjs";
import { SOURCES } from "../src/sources.mjs";

const LIVE_TESTS = process.env.LIVE_TESTS === "1";
const USER_AGENT = "sorties-lorient-alertes-live-audit/1.0";

test("le gate d'activation exige un motif concret pour chaque source désactivée", () => {
  assert.ok(SOURCES.some((source) => source.enabled), "au moins une source doit rester active");
  for (const source of SOURCES) {
    assert.equal(typeof source.enabled, "boolean", `${source.id}: enabled doit être booléen`);
    if (source.enabled) {
      assert.equal(source.disabledReason, null, `${source.id}: une source active ne porte pas de motif`);
    } else {
      assert.match(
        source.disabledReason ?? "",
        /\S.{15,}/u,
        `${source.id}: une source inactive doit expliquer le risque observé`,
      );
    }
  }
});

test("chaque source active respecte son contrat live", { skip: !LIVE_TESTS }, async () => {
  const activeSources = SOURCES.filter((source) => source.enabled);
  const collection = await collectDueSources({
    sources: activeSources,
    now: new Date(),
    fetchText: async (url, options = {}) => {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`Lecture de source refusée (HTTP ${response.status})`);
      return response.text();
    },
  });

  assert.deepEqual(collection.skipped, []);
  assert.deepEqual(
    collection.failures,
    [],
    collection.failures.map(({ source, message }) => `${source.id}: ${message}`).join("\n"),
  );
  assert.deepEqual(
    collection.successes.map(({ source }) => source.id).sort(),
    activeSources.map(({ id }) => id).sort(),
  );

  for (const { source, events } of collection.successes) {
    for (const event of events) {
      assert.deepEqual(createEvent(event), event, `${source.id}: événement live invalide`);
      assert.equal(event.sourceId, source.id);
      assert.equal(new URL(event.bookingUrl).protocol, "https:");
    }
  }
});
