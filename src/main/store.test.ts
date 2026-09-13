import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backupCorruptStateFile } from "./corrupt-backup.ts";
import { normalizeSettings } from "./settings-normalize.ts";

test("normalizeSettings clamps concurrency and drops blank preferredHost", () => {
  assert.equal(normalizeSettings({ maxConcurrentRuns: 99 }).maxConcurrentRuns, 4);
  assert.equal(normalizeSettings({ maxConcurrentRuns: 0 }).maxConcurrentRuns, 1);
  assert.equal(normalizeSettings({ maxConcurrentRuns: "2" }).maxConcurrentRuns, 2);
  assert.equal(normalizeSettings({ maxConcurrentRuns: null }).maxConcurrentRuns, 1);
  assert.equal(normalizeSettings({ preferredHost: "  " }).preferredHost, undefined);
  assert.equal(normalizeSettings({ preferredHost: " 10.0.0.2 " }).preferredHost, "10.0.0.2");
  assert.equal(normalizeSettings({ closeToTray: 0 }).closeToTray, false);
  assert.equal(normalizeSettings({ agents: { cursor: { access: "full", model: "x", command: "  " } } }).agents.cursor?.command, undefined);
  assert.equal(normalizeSettings({ agents: { cursor: { access: "full", model: "x" } } }).agents.cursor?.access, "full");
  assert.equal(normalizeSettings("nope").maxConcurrentRuns, 1);
});

test("backupCorruptStateFile renames synchronously so a later flush cannot lose the new file", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-store-"));
  try {
    const file = join(dir, "state.json");
    writeFileSync(file, "{not-json", "utf8");
    const backup = backupCorruptStateFile(file, () => 12345);
    assert.equal(backup, `${file}.corrupt-12345`);
    assert.equal(existsSync(file), false);
    assert.equal(readFileSync(backup!, "utf8"), "{not-json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
