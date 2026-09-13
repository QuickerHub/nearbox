import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCursorAgentBundle } from "./cursor-bundle.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "nearbox-cursor-bundle-"));
}

test("resolveCursorAgentBundle prefers in-place node.exe + index.js", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "node.exe"), "");
    writeFileSync(join(dir, "index.js"), "");
    mkdirSync(join(dir, "versions", "2026.1.1"), { recursive: true });
    writeFileSync(join(dir, "versions", "2026.1.1", "node.exe"), "");
    writeFileSync(join(dir, "versions", "2026.1.1", "index.js"), "");
    const resolved = resolveCursorAgentBundle(dir);
    assert.equal(resolved?.file, join(dir, "node.exe"));
    assert.deepEqual(resolved?.prefixArgs, [join(dir, "index.js")]);
    assert.equal(resolved?.viaCmd, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle picks the newest complete versions/ folder", () => {
  const dir = scratch();
  try {
    const older = join(dir, "versions", "2025.12.01-01-00-00");
    const newer = join(dir, "versions", "2026.03.15-12-30-00");
    const incomplete = join(dir, "versions", "2026.09.01");
    for (const path of [older, newer]) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "node.exe"), "");
      writeFileSync(join(path, "index.js"), "");
    }
    mkdirSync(incomplete, { recursive: true });
    writeFileSync(join(incomplete, "index.js"), "");
    const resolved = resolveCursorAgentBundle(dir);
    assert.equal(resolved?.file, join(newer, "node.exe"));
    assert.deepEqual(resolved?.prefixArgs, [join(newer, "index.js")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle returns null without a usable bundle", () => {
  const dir = scratch();
  try {
    assert.equal(resolveCursorAgentBundle(dir), null);
    mkdirSync(join(dir, "versions", "not-a-date"), { recursive: true });
    writeFileSync(join(dir, "versions", "not-a-date", "node.exe"), "");
    writeFileSync(join(dir, "versions", "not-a-date", "index.js"), "");
    assert.equal(resolveCursorAgentBundle(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
