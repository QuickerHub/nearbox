import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedFile, sanitizeFileName } from "./file-guard.ts";

test("sanitizeFileName strips path and reserved Windows names", () => {
  assert.equal(sanitizeFileName("..\\..\\secret.txt", "file"), "secret.txt");
  assert.equal(sanitizeFileName("CON", "file"), "CON_file");
  assert.equal(sanitizeFileName("photo.jpg", "file"), "photo.jpg");
  // A slash in the raw name is treated as a path separator (node:path basename).
  assert.equal(sanitizeFileName('a<b>:"/|?*.png', "file"), "___.png");
  assert.equal(sanitizeFileName("...", "image"), "image");
});

test("assertAllowedFile rejects executables and scripts", () => {
  assert.throws(() => assertAllowedFile("run.exe", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("x.ps1", "text/plain"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("ok.bin", "application/x-msdownload"), /可执行文件/);
  assert.throws(() => assertAllowedFile("app.apk", "application/vnd.android.package-archive"), /可执行文件或脚本/);
  assert.doesNotThrow(() => assertAllowedFile("note.md", "text/markdown"));
  assert.doesNotThrow(() => assertAllowedFile("shot.png", "image/png"));
});

test("sanitizeFileName renames Windows reserved names with extra dots", () => {
  assert.equal(sanitizeFileName("COM1.foo.bar", "file"), "COM1.foo_file.bar");
  assert.equal(sanitizeFileName("nul.tar.gz", "file"), "nul.tar_file.gz");
  assert.equal(sanitizeFileName("LPT1.x.y", "file"), "LPT1.x_file.y");
});

test("assertAllowedFile rejects extra script and binary extensions", () => {
  assert.throws(() => assertAllowedFile("x.mjs", "text/javascript"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("x.cjs", "text/javascript"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("lib.dll", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("app.jar", "application/java-archive"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("folder.scf", "application/octet-stream"), /可执行文件或脚本/);
});
