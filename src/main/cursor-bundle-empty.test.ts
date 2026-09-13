import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { isNonEmptyRegularFile, resolveCursorAgentBundle } from "./cursor-bundle.ts";

test("isNonEmptyRegularFile rejects missing and zero-byte paths", () => {
  const dir = join(tmpdir(), `nearbox-cursor-empty-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const empty = join(dir, "empty.exe");
    writeFileSync(empty, "");
    assert.equal(isNonEmptyRegularFile(empty), false);
    const full = join(dir, "full.exe");
    writeFileSync(full, "MZ");
    assert.equal(isNonEmptyRegularFile(full), true);
    assert.equal(isNonEmptyRegularFile(join(dir, "missing.exe")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCursorAgentBundle skips zero-byte node.exe placeholders", () => {
  const dir = join(tmpdir(), `nearbox-cursor-bundle-${process.pid}-${Date.now()}`);
  mkdirSync(join(dir, "versions", "2024.1.1"), { recursive: true });
  try {
    writeFileSync(join(dir, "versions", "2024.1.1", "node.exe"), "");
    writeFileSync(join(dir, "versions", "2024.1.1", "index.js"), "console.log(1)");
    assert.equal(resolveCursorAgentBundle(dir), null);

    writeFileSync(join(dir, "versions", "2024.1.1", "node.exe"), "MZ");
    const bundle = resolveCursorAgentBundle(dir);
    assert.ok(bundle);
    assert.equal(bundle!.prefixArgs[0], join(dir, "versions", "2024.1.1", "index.js"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
