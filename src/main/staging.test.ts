import assert from "node:assert/strict";
import { writeFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { removeStaleStagingParts } from "./staging.ts";

test("removeStaleStagingParts deletes only old .part files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nearbox-staging-"));
  const oldPart = join(dir, "old.part");
  const freshPart = join(dir, "fresh.part");
  const keep = join(dir, "note.txt");
  await writeFile(oldPart, "x");
  await writeFile(freshPart, "y");
  await writeFile(keep, "z");
  const oldTime = Date.now() - 60_000;
  await utimes(oldPart, oldTime / 1000, oldTime / 1000);

  const removed = await removeStaleStagingParts(dir, 10_000, Date.now());
  assert.equal(removed, 1);
  await assert.rejects(() => stat(oldPart));
  assert.ok(await stat(freshPart));
  assert.ok(await stat(keep));
});

test("removeStaleStagingParts tolerates a missing directory", async () => {
  const dir = join(tmpdir(), `nearbox-staging-missing-${Date.now()}`);
  assert.equal(await removeStaleStagingParts(dir, 1000), 0);
});
