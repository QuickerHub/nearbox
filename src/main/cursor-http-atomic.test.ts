import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeCliConfigAtomic } from "./cursor-http.ts";

test("writeCliConfigAtomic replaces the target via rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cli-config-"));
  const path = join(dir, "cli-config.json");
  try {
    writeFileSync(path, '{"network":{}}\n', "utf8");
    writeCliConfigAtomic(path, '{"network":{"useHttp1ForAgent":true}}\n');
    assert.equal(readFileSync(path, "utf8"), '{"network":{"useHttp1ForAgent":true}}\n');
    assert.equal(readdirSync(dir).filter((name) => name.includes(".tmp-")).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
