import test from "node:test";
import assert from "node:assert/strict";

import { SOURCES, getSource } from "../src/sources.mjs";

test("l'inventaire source est exploitable sans doublon", () => {
  const ids = SOURCES.map((source) => source.id);
  const urls = SOURCES.map((source) => source.url);

  assert.equal(new Set(ids).size, SOURCES.length);
  assert.equal(new Set(urls).size, SOURCES.length);
  assert.ok(SOURCES.every((source) =>
    [source.url, source.homeUrl].every((url) => new URL(url).protocol === "https:"),
  ));
});

test("les six billetteries Mapado prioritaires sont interrogées toutes les 15 minutes", () => {
  const mapadoSources = SOURCES.filter((source) => source.adapter === "mapado");

  assert.deepEqual(
    mapadoSources.map((source) => source.id).sort(),
    [
      "mapado-arcs",
      "mapado-coque",
      "mapado-estran",
      "mapado-oceanis",
      "mapado-quai9",
      "mapado-strapontin",
    ],
  );
  assert.ok(mapadoSources.every((source) => source.pollEveryMinutes === 15));
});

test("les agendas territoriaux sont interrogés toutes les 60 minutes", () => {
  const territorialSources = [getSource("tourism"), getSource("lorient-events")];

  assert.ok(territorialSources.every((source) => source.pollEveryMinutes === 60));
});

test("les salles directes sont interrogées toutes les 15 minutes", () => {
  const directSources = [
    getSource("theatre-lorient"),
    getSource("hydrophone"),
    getSource("trios"),
  ];

  assert.ok(directSources.every((source) => source.pollEveryMinutes === 15));
});

test("chaque source est explicitement activée ou désactivée avec un motif", () => {
  for (const source of SOURCES) {
    assert.equal(typeof source.enabled, "boolean");
    if (source.enabled) assert.equal(source.disabledReason, null);
    else assert.match(source.disabledReason ?? "", /\S/u);
  }
});

test("getSource refuse un identifiant inconnu", () => {
  assert.throws(() => getSource("inconnue"), /Source inconnue: inconnue/);
});
