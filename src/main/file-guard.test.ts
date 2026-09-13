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

test("sanitizeFileName falls back, clamps length, and rewrites more reserved names", () => {
  assert.equal(sanitizeFileName(undefined, "file"), "file");
  assert.equal(sanitizeFileName("   ", "image"), "image");
  assert.equal(sanitizeFileName("COM1.txt", "file"), "COM1_file.txt");
  assert.equal(sanitizeFileName("lpt9.log", "file"), "lpt9_file.log");
  const long = `${"a".repeat(200)}.png`;
  assert.equal(sanitizeFileName(long, "file").length, 180);
  assert.ok(sanitizeFileName(long, "file").startsWith("a"));
});

test("assertAllowedFile rejects script extensions beyond the smoke list", () => {
  assert.throws(() => assertAllowedFile("x.bat", "text/plain"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("x.js", "text/javascript"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("shortcut.lnk", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("ok.bin", "application/x-dosexec"), /可执行文件/);
  assert.doesNotThrow(() => assertAllowedFile("archive.zip", "application/zip"));
});
