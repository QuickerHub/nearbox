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

test("assertAllowedFile rejects search-ms / ClickOnce / scriptlet leftovers", () => {
  assert.throws(() => assertAllowedFile("find.search-ms", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("panel.settingcontent-ms", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("fix.diagcab", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("setup.application", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("comp.wsc", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("comp.sct", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("task.job", "application/octet-stream"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("app.jnlp", "application/octet-stream"), /可执行文件或脚本/);
});
