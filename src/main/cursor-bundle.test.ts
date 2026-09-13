import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isRegularFile, resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("isRegularFile rejects directories that share a bundle name", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
  try {
    const decoy = join(dir, "node.exe");
    mkdirSync(decoy);
    assert.equal(isRegularFile(decoy), false);
    assert.equal(isRegularFile(join(dir, "missing")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle ignores a directory posing as node.exe", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
  try {
    writeFileSync(join(dir, "index.js"), "console.log(1)\n");
    mkdirSync(join(dir, "node.exe"));
    assert.equal(resolveCursorAgentBundle(dir), null);

    const versions = join(dir, "versions", "2024.1.1-00-00-00");
    mkdirSync(versions, { recursive: true });
    writeFileSync(join(versions, "index.js"), "console.log(1)\n");
    writeFileSync(join(versions, "node.exe"), "MZ");
    const bundle = resolveCursorAgentBundle(dir);
    assert.ok(bundle);
    assert.equal(bundle?.file, join(versions, "node.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
