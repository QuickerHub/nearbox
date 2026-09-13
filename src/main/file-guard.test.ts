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

test("assertAllowedFile rejects leftover Office macros, CHM, ISO and Excel hooks", () => {
  assert.throws(() => assertAllowedFile("macro.docm", "application/vnd.ms-word.document.macroEnabled.12"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("book.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("help.chm", "application/vnd.ms-htmlhelp"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("disk.iso", "application/x-iso9660-image"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("sheet.iqy", "text/plain"), /可执行文件或脚本/);
  assert.throws(() => assertAllowedFile("addin.xll", "application/octet-stream"), /可执行文件或脚本/);
  assert.doesNotThrow(() => assertAllowedFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
});
