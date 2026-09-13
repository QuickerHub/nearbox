import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "./store-write.ts";

test("writeJsonAtomic persists UTF-8 JSON through tmp+fsync+rename", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-atomic-"));
  try {
    const file = join(dir, "state.json");
    await writeJsonAtomic(file, '{\n  "ok": true\n}');
    assert.equal(JSON.parse(readFileSync(file, "utf8")).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
