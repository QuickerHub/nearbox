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

test("sanitizeFileName keeps the extension when truncating long names", () => {
  const long = `${"a".repeat(200)}.exe`;
  const cleaned = sanitizeFileName(long, "file");
  assert.ok(cleaned.endsWith(".exe"), cleaned);
  assert.ok(cleaned.length <= 180, String(cleaned.length));
  assert.throws(() => assertAllowedFile(cleaned, "application/octet-stream"), /可执行文件或脚本/);

  const longPng = `${"图".repeat(120)}.png`;
  const png = sanitizeFileName(longPng, "image");
  assert.ok(png.endsWith(".png"));
  assert.ok(png.length <= 180);
  assert.doesNotThrow(() => assertAllowedFile(png, "image/png"));
});

test("assertAllowedFile rejects executables and scripts", () => {
  assert.throws(() => assertAllowedFile("run.exe", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("x.ps1", "text/plain"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("ok.bin", "application/x-msdownload"), /可执行文件/);
  assert.throws(() => assertAllowedFile("app.apk", "application/vnd.android.package-archive"), /可执行文件或脚本/);
  assert.doesNotThrow(() => assertAllowedFile("note.md", "text/markdown"));
  assert.doesNotThrow(() => assertAllowedFile("shot.png", "image/png"));
});
