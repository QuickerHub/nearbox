import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCliConfigFile, writeCliConfigFile } from "./cursor-http.ts";

test("readCliConfigFile treats an empty file as {}", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cli-empty-"));
  const path = join(dir, "cli-config.json");
  writeFileSync(path, "");
  assert.deepEqual(readCliConfigFile(path), {});
});

test("readCliConfigFile / writeCliConfigFile refuse a directory path", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cli-dir-"));
  const path = join(dir, "cli-config.json");
  mkdirSync(path);
  assert.throws(() => readCliConfigFile(path), /regular file/);
  assert.throws(() => writeCliConfigFile(path, { network: { useHttp1ForAgent: true } }), /regular file/);
});

test("readCliConfigFile refuses a symlink", { skip: process.platform === "win32" ? "symlink privileges" : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-cli-link-"));
  const target = join(dir, "target.json");
  const path = join(dir, "cli-config.json");
  writeFileSync(target, '{"network":{}}');
  symlinkSync(target, path);
  assert.throws(() => readCliConfigFile(path), /regular file/);
});
