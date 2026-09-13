import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedFile, normalizeMediaType, sanitizeFileName } from "./file-guard.ts";

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

test("sanitizeFileName strips invisible marks so exe stays visible", () => {
  assert.equal(sanitizeFileName("photo.exe\u200b", "file"), "photo.exe");
  assert.equal(sanitizeFileName("invoice\u202etxt.exe", "file"), "invoicetxt.exe");
  assert.throws(() => assertAllowedFile("setup.exe\u200b", "application/octet-stream"), /可执行文件或脚本/);
});

test("normalizeMediaType keeps real types and drops junk", () => {
  assert.equal(normalizeMediaType("image/jpeg"), "image/jpeg");
  assert.equal(normalizeMediaType("image/png; charset=binary"), "image/png");
  assert.equal(normalizeMediaType("text/html\r\nSet-Cookie: x=1"), "application/octet-stream");
  assert.equal(normalizeMediaType(["image/webp", "text/html"]), "image/webp");
  assert.equal(normalizeMediaType(undefined), "application/octet-stream");
  assert.equal(normalizeMediaType(""), "application/octet-stream");
});
