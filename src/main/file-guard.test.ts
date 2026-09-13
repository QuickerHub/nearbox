import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedFile, assertUploadSize, deviceInboxSegment, sanitizeFileName } from "./file-guard.ts";

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

test("deviceInboxSegment prefers phone id over shared display names", () => {
  assert.equal(deviceInboxSegment({ id: "phone-ab12cd", name: "Android 手机" }), "phone-ab12cd");
  assert.equal(deviceInboxSegment({ id: "phone-ef34", name: "Android 手机" }), "phone-ef34");
  assert.equal(deviceInboxSegment({ id: "desktop", name: "CEA-LAPTOP" }), "CEA-LAPTOP");
});

test("assertUploadSize rejects an oversized Content-Length", () => {
  assert.throws(() => assertUploadSize("100", 50), (error: { code?: string }) => {
    assert.equal(error.code, "FILE_TOO_LARGE");
    return true;
  });
  assert.doesNotThrow(() => assertUploadSize("50", 50));
  assert.doesNotThrow(() => assertUploadSize(undefined, 50));
});
