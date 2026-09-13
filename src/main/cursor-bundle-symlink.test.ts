import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isPlainRegularFile, resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("isPlainRegularFile rejects symlinks even when the target is a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-bundle-plain-"));
  try {
    const real = join(dir, "real.js");
    const link = join(dir, "link.js");
    writeFileSync(real, "ok");
    symlinkSync(real, link);
    assert.equal(isPlainRegularFile(real), true);
    assert.equal(isPlainRegularFile(link), false);
    assert.equal(isPlainRegularFile(join(dir, "missing")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle skips symlink version folders", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-bundle-ver-"));
  try {
    const versions = join(dir, "versions");
    const real = join(dir, "outside-2024.01.01");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "node.exe"), "node");
    writeFileSync(join(real, "index.js"), "index");
    mkdirSync(versions, { recursive: true });
    symlinkSync(real, join(versions, "2024.01.01"));
    assert.equal(resolveCursorAgentBundle(dir), null);

    const good = join(versions, "2024.02.02");
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, "node.exe"), "node");
    writeFileSync(join(good, "index.js"), "index");
    const resolved = resolveCursorAgentBundle(dir);
    assert.ok(resolved);
    assert.equal(resolved?.file, join(good, "node.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
