import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isPlainDirectory, isUsableBundleFile, resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("isUsableBundleFile rejects symlinks and zero-byte placeholders", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-bundle-usable-"));
  try {
    const real = join(dir, "real.exe");
    const empty = join(dir, "empty.exe");
    const link = join(dir, "link.exe");
    writeFileSync(real, "MZ");
    writeFileSync(empty, "");
    symlinkSync(real, link);
    assert.equal(isUsableBundleFile(real), true);
    assert.equal(isUsableBundleFile(empty), false);
    assert.equal(isUsableBundleFile(link), false);
    assert.equal(isUsableBundleFile(join(dir, "missing")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle rejects a symlinked versions directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-bundle-versions-"));
  try {
    const outside = join(dir, "outside");
    mkdirSync(join(outside, "2024.01.01"), { recursive: true });
    writeFileSync(join(outside, "2024.01.01", "node.exe"), "MZ");
    writeFileSync(join(outside, "2024.01.01", "index.js"), "index");
    symlinkSync(outside, join(dir, "versions"));
    assert.equal(isPlainDirectory(join(dir, "versions")), false);
    assert.equal(resolveCursorAgentBundle(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle skips symlink version folders and empty binaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-bundle-entry-"));
  try {
    const versions = join(dir, "versions");
    mkdirSync(versions, { recursive: true });
    const evilTarget = join(dir, "evil-2024.01.01");
    mkdirSync(evilTarget, { recursive: true });
    writeFileSync(join(evilTarget, "node.exe"), "MZ");
    writeFileSync(join(evilTarget, "index.js"), "index");
    symlinkSync(evilTarget, join(versions, "2024.01.01"));

    const empty = join(versions, "2024.02.02");
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, "node.exe"), "");
    writeFileSync(join(empty, "index.js"), "index");

    const good = join(versions, "2024.03.03");
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, "node.exe"), "MZ");
    writeFileSync(join(good, "index.js"), "index");

    const resolved = resolveCursorAgentBundle(dir);
    assert.ok(resolved);
    assert.equal(resolved?.file, join(good, "node.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
