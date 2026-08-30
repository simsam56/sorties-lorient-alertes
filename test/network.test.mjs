import test from "node:test";
import assert from "node:assert/strict";

import { sendNtfy } from "../src/network.mjs";

const validTopic = "a".repeat(24);
const notification = {
  ids: ["event-id"],
  title: "Nouvelle sortie près de Lorient",
  message: "[Concert](https://billetterie.example.test/concert)",
  clickUrl: "https://billetterie.example.test/concert",
  priority: 4,
  tags: ["ticket", "performing_arts"],
  markdown: true,
};

test("publie le JSON ntfy attendu à la racine avec le sujet dans le corps", async () => {
  let request;
  await sendNtfy({
    topic: validTopic,
    notification,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });

  assert.equal(request.url, "https://ntfy.sh/");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(request.options.headers, { "Content-Type": "application/json" });
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.options.body), {
    topic: validTopic,
    title: notification.title,
    message: notification.message,
    click: notification.clickUrl,
    priority: 4,
    tags: ["ticket", "performing_arts"],
    markdown: true,
  });
});

test("refuse un sujet absent ou hors du format aléatoire autorisé", async () => {
  for (const topic of [undefined, "court", "a".repeat(65), "sujet-é-invalide-123456789"]) {
    await assert.rejects(
      sendNtfy({ topic, notification, fetchImpl: async () => ({ ok: true, status: 200 }) }),
      /Sujet ntfy absent ou invalide/u,
    );
  }
});

test("signale un refus HTTP sans révéler le sujet", async () => {
  await assert.rejects(
    sendNtfy({
      topic: validTopic,
      notification,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    (error) => {
      assert.match(error.message, /Notification ntfy refusée \(HTTP 503\)/u);
      assert.doesNotMatch(error.message, new RegExp(validTopic, "u"));
      return true;
    },
  );
});

test("neutralise une erreur réseau qui contient l'URL du sujet", async () => {
  await assert.rejects(
    sendNtfy({
      topic: validTopic,
      notification,
      fetchImpl: async () => { throw new Error(`connexion refusée https://ntfy.sh/${validTopic}`); },
    }),
    (error) => {
      assert.match(error.message, /Publication ntfy impossible/u);
      assert.doesNotMatch(error.message, new RegExp(validTopic, "u"));
      return true;
    },
  );
});

test("interrompt la publication après le délai demandé", async () => {
  let aborted = false;
  await assert.rejects(
    sendNtfy({
      topic: validTopic,
      notification,
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        // AbortSignal.timeout() n'empêche pas Node de quitter à lui seul. Une
        // vraie requête réseau maintient la boucle active ; ce minuteur simule
        // cette ressource pour que le test reste fiable sous Node 22.
        const pendingRequest = setTimeout(() => {
          reject(new Error("La requête simulée aurait dû être interrompue"));
        }, 1_000);
        signal.addEventListener("abort", () => {
          clearTimeout(pendingRequest);
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      }),
    }),
    /Publication ntfy impossible/u,
  );
  assert.equal(aborted, true);
});
