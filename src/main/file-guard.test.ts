import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedFile, inboxFolderSegment, isInboxPath, sanitizeFileName } from "./file-guard.ts";
import { resolve } from "node:path";

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

test("inboxFolderSegment renames Windows reserved device folders", () => {
  assert.equal(inboxFolderSegment("NUL"), "NUL_phone");
  assert.equal(inboxFolderSegment("CON"), "CON_phone");
  assert.equal(inboxFolderSegment("COM1"), "COM1_phone");
  assert.equal(inboxFolderSegment("photo-inbox"), "photo-inbox");
  assert.equal(inboxFolderSegment("foo. "), "foo");
  assert.equal(inboxFolderSegment("Android 手机"), "Android 手机");
});

test("isInboxPath rejects parents and prefix-sibling escapes", () => {
  const root = resolve("/home/me/.nearbox/inbox");
  assert.equal(isInboxPath(root, resolve(root, "phone-ab", "a.jpg")), true);
  assert.equal(isInboxPath(root, resolve(root, "..", "state.json")), false);
  assert.equal(isInboxPath(root, resolve("/home/me/.nearbox/inbox2/secret")), false);
});
