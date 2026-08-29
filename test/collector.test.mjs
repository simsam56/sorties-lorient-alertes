import test from "node:test";
import assert from "node:assert/strict";

import { collectDueSources } from "../src/collector.mjs";

const now = new Date("2026-08-30T10:00:00.000Z");

function source(id, adapter, pollEveryMinutes = 15, enabled = true) {
  return {
    id,
    name: id,
    url: `https://${id}.example.test/agenda`,
    adapter,
    pollEveryMinutes,
    enabled,
  };
}

test("collecte chaque source activée échue et isole un adaptateur en erreur", async () => {
  const fast = source("rapide", "ok");
  const slow = source("lente", "ok", 60);
  const broken = source("cassée", "broken");
  const calls = [];

  const result = await collectDueSources({
    sources: [fast, slow, broken],
    sourceState: { lente: { checkedAt: "2026-08-30T09:50:00.000Z" } },
    fetchText: async (url, options) => {
      calls.push({ url, options });
      return "<main>agenda</main>";
    },
    now,
    adapters: {
      ok: () => [{ title: "Concert" }],
      broken: () => { throw new Error("adaptateur indisponible"); },
    },
  });

  assert.deepEqual(result.successes, [{
    source: fast,
    events: [{ title: "Concert" }],
    checkedAt: "2026-08-30T10:00:00.000Z",
  }]);
  assert.deepEqual(result.skipped, [{ source: slow, reason: "not-due" }]);
  assert.deepEqual(result.failures, [{
    source: broken,
    message: "adaptateur indisponible",
    checkedAt: "2026-08-30T10:00:00.000Z",
  }]);
  assert.deepEqual(result.candidateUpdates, {});
  assert.deepEqual(calls.map(({ url }) => url).sort(), [fast.url, broken.url].sort());
  assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
});

test("ignore une source désactivée sans la récupérer", async () => {
  const disabled = source("désactivée", "ok", 15, false);
  let called = false;

  const result = await collectDueSources({
    sources: [disabled],
    sourceState: {},
    fetchText: async () => { called = true; return ""; },
    now,
    adapters: { ok: () => [] },
  });

  assert.deepEqual(result.skipped, [{ source: disabled, reason: "disabled" }]);
  assert.equal(called, false);
});

test("réutilise pendant six heures une résolution territoriale réussie et publie les mises à jour en mémoire", async () => {
  const tourism = source("tourisme", "tourism", 60);
  const cachedCandidate = {
    title: "Déjà résolu",
    startsOn: "2026-09-12",
    venue: "Théâtre",
    city: "Lorient",
    detailUrl: "https://tourisme.example.test/deja-resolu",
    sourceId: tourism.id,
  };
  const freshCandidate = {
    title: "Nouveau",
    startsOn: "2026-09-13",
    venue: "Hydrophone",
    city: "Lorient",
    detailUrl: "https://tourisme.example.test/nouveau",
    sourceId: tourism.id,
  };
  const cachedEvent = { title: "Déjà résolu", bookingUrl: "https://billets.example.test/deja" };
  const freshEvent = { title: "Nouveau", bookingUrl: "https://billets.example.test/nouveau" };
  const fetchedUrls = [];

  const result = await collectDueSources({
    sources: [tourism],
    sourceState: {},
    candidateState: {
      [cachedCandidate.detailUrl]: {
        checkedAt: "2026-08-30T05:00:01.000Z",
        event: cachedEvent,
      },
    },
    fetchText: async (url) => {
      fetchedUrls.push(url);
      return url === tourism.url ? "<main>liste</main>" : "<main>détail</main>";
    },
    now,
    candidateParsers: { tourism: () => [cachedCandidate, freshCandidate] },
    resolveReservation: (_html, candidate) => candidate.title === "Nouveau" ? freshEvent : cachedEvent,
  });

  assert.deepEqual(result.successes, [{
    source: tourism,
    events: [cachedEvent, freshEvent],
    checkedAt: "2026-08-30T10:00:00.000Z",
  }]);
  assert.deepEqual(fetchedUrls, [tourism.url, freshCandidate.detailUrl]);
  assert.deepEqual(result.candidateUpdates, {
    [freshCandidate.detailUrl]: {
      checkedAt: "2026-08-30T10:00:00.000Z",
      event: freshEvent,
    },
  });
});

test("attache un échec de détail à sa source sans masquer les autres sources", async () => {
  const direct = source("direct", "ok");
  const tourism = source("tourisme", "tourism", 60);
  const goodCandidate = {
    title: "Résolu",
    startsOn: "2026-09-14",
    venue: "Théâtre",
    city: "Lorient",
    detailUrl: "https://tourisme.example.test/bon",
    sourceId: tourism.id,
  };
  const brokenCandidate = { ...goodCandidate, title: "Cassé", detailUrl: "https://tourisme.example.test/casse" };
  const goodEvent = { title: "Résolu", bookingUrl: "https://billets.example.test/bon" };

  const result = await collectDueSources({
    sources: [direct, tourism],
    sourceState: {},
    fetchText: async (url) => {
      if (url === brokenCandidate.detailUrl) throw new Error("détail inaccessible");
      return "<main>officiel</main>";
    },
    now,
    adapters: { ok: () => [{ title: "Billetterie directe" }] },
    candidateParsers: { tourism: () => [goodCandidate, brokenCandidate] },
    resolveReservation: () => goodEvent,
  });

  assert.deepEqual(result.successes, [{
    source: direct,
    events: [{ title: "Billetterie directe" }],
    checkedAt: "2026-08-30T10:00:00.000Z",
  }]);
  assert.deepEqual(result.failures, [{
    source: tourism,
    message: "détail inaccessible",
    checkedAt: "2026-08-30T10:00:00.000Z",
  }]);
  assert.deepEqual(result.candidateUpdates, {
    [goodCandidate.detailUrl]: {
      checkedAt: "2026-08-30T10:00:00.000Z",
      event: goodEvent,
    },
  });
});

test("ne résout jamais plus de cinq détails territoriaux simultanément", async () => {
  const tourism = source("tourisme", "tourism", 60);
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    title: `Spectacle ${index}`,
    startsOn: "2026-09-15",
    venue: "Théâtre",
    city: "Lorient",
    detailUrl: `https://tourisme.example.test/${index}`,
    sourceId: tourism.id,
  }));
  let activeDetails = 0;
  let maxActiveDetails = 0;

  const result = await collectDueSources({
    sources: [tourism],
    sourceState: {},
    fetchText: async (url) => {
      if (url === tourism.url) return "<main>liste</main>";
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDetails -= 1;
      return "<main>détail</main>";
    },
    now,
    candidateParsers: { tourism: () => candidates },
    resolveReservation: (_html, candidate) => ({ title: candidate.title }),
  });

  assert.equal(result.successes[0].events.length, 6);
  assert.equal(maxActiveDetails, 5);
});
