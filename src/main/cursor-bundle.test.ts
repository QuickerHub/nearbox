import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("resolveCursorAgentBundle returns null when versions is not a directory", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
  try {
    const shim = join(root, "shim");
    mkdirSync(shim);
    writeFileSync(join(shim, "versions"), "not-a-dir");
    assert.equal(resolveCursorAgentBundle(shim), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle picks the newest versions/* bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
  try {
    const shim = join(root, "shim");
    const older = join(shim, "versions", "2024.1.1");
    const newer = join(shim, "versions", "2025.6.15");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    for (const dir of [older, newer]) {
      writeFileSync(join(dir, "node.exe"), "node");
      writeFileSync(join(dir, "index.js"), "js");
    }
    const bundle = resolveCursorAgentBundle(shim);
    assert.ok(bundle);
    assert.equal(bundle.file, join(newer, "node.exe"));
    assert.deepEqual(bundle.prefixArgs, [join(newer, "index.js")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
