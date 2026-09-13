import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedFile, sanitizeFileName, safeInboxSegment, uploadNameFromQuery } from "./file-guard.ts";

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

test("safeInboxSegment blocks empty and dot segments", () => {
  assert.equal(safeInboxSegment(""), "phone");
  assert.equal(safeInboxSegment(".."), "phone");
  assert.equal(safeInboxSegment("."), "phone");
  assert.equal(safeInboxSegment("Android 手机"), "Android 手机");
  assert.equal(safeInboxSegment('a/b\\c'), "a_b_c");
});

test("uploadNameFromQuery does not double-decode", () => {
  assert.equal(uploadNameFromQuery("100%done.jpg"), "100%done.jpg");
  assert.equal(uploadNameFromQuery("photo%20.jpg"), "photo%20.jpg");
  assert.equal(uploadNameFromQuery("café.png"), "café.png");
  assert.equal(uploadNameFromQuery(""), "file");
  assert.equal(uploadNameFromQuery(null), "file");
});
