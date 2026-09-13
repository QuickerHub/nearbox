import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_CURSOR_VERSIONS_PROBE, resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("resolveCursorAgentBundle probes newest version folders first and returns a hit", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
  const versions = join(root, "versions");
  mkdirSync(versions);
  // Older complete install
  const older = join(versions, "2024.1.1-00-00-00");
  mkdirSync(older);
  writeFileSync(join(older, "node.exe"), "");
  writeFileSync(join(older, "index.js"), "");
  // Newer incomplete (no binaries) should be skipped
  const newer = join(versions, "2025.6.1-12-00-00");
  mkdirSync(newer);
  const resolved = resolveCursorAgentBundle(root);
  assert.ok(resolved);
  assert.ok(resolved!.file.includes("2024.1.1"));
  assert.ok(MAX_CURSOR_VERSIONS_PROBE >= 1);
});
