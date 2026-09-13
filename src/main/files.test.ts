import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uniquePath } from "./files.ts";

test("uniquePath returns the original name when free, else (n) suffixes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-unique-"));
  try {
    const first = await uniquePath(dir, "shot.png");
    assert.equal(first, join(dir, "shot.png"));
    writeFileSync(first, "a");
    const second = await uniquePath(dir, "shot.png");
    assert.equal(second, join(dir, "shot (1).png"));
    writeFileSync(second, "b");
    const third = await uniquePath(dir, "shot.png");
    assert.equal(third, join(dir, "shot (2).png"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uniquePath preserves multi-dot stems", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-unique-"));
  try {
    writeFileSync(join(dir, "archive.tar.gz"), "x");
    const next = await uniquePath(dir, "archive.tar.gz");
    assert.equal(next, join(dir, "archive.tar (1).gz"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
