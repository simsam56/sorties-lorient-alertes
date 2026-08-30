import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const plistPath = new URL("../ops/fr.baliseia.sorties-lorient-alertes.plist", import.meta.url);

test("le service macOS demande à GitHub un contrôle toutes les quinze minutes", async () => {
  const raw = await readFile(plistPath);
  const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], {
    input: raw,
    encoding: "utf8",
  }));

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
  assert.doesNotMatch(raw.toString("utf8"), /NTFY|topic|secret/ui);
});
