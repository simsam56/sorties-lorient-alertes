import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";

const plistPath = new URL("../ops/fr.baliseia.sorties-lorient-alertes.plist", import.meta.url);

function parsePlist(raw) {
  const $ = load(raw, { xmlMode: true });
  const elementChildren = (node) => node.children.filter(({ type }) => type === "tag");
  const parseValue = (node) => {
    if (node.name === "string") return $(node).text();
    if (node.name === "integer") return Number.parseInt($(node).text(), 10);
    if (node.name === "true") return true;
    if (node.name === "false") return false;
    if (node.name === "array") return elementChildren(node).map(parseValue);
    if (node.name === "dict") {
      const entries = elementChildren(node);
      const value = {};
      for (let index = 0; index < entries.length; index += 2) {
        assert.equal(entries[index]?.name, "key");
        assert.ok(entries[index + 1]);
        value[$(entries[index]).text()] = parseValue(entries[index + 1]);
      }
      return value;
    }
    throw new Error(`Type plist non pris en charge : ${node.name}`);
  };
  return parseValue($("plist > dict").get(0));
}

test("le service macOS demande à GitHub un contrôle toutes les quinze minutes", async () => {
  const raw = await readFile(plistPath, "utf8");
  const plist = parsePlist(raw);

  assert.equal(plist.Label, "fr.baliseia.sorties-lorient-alertes");
  assert.equal(plist.StartInterval, 900);
  assert.equal(plist.RunAtLoad, true);
  assert.equal(plist.ProcessType, "Background");
  assert.deepEqual(plist.ProgramArguments, [
    "/opt/homebrew/bin/gh",
    "workflow",
    "run",
    "monitor.yml",
    "--repo",
    "simsam56/sorties-lorient-alertes",
    "-f",
    "mode=check",
  ]);
  assert.equal(plist.StandardOutPath, "/Users/simonhingant/Library/Logs/sorties-lorient-alertes.log");
  assert.equal(plist.StandardErrorPath, "/Users/simonhingant/Library/Logs/sorties-lorient-alertes.error.log");
  assert.doesNotMatch(raw, /NTFY|topic|secret/ui);
});
