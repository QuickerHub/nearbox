import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, symlinkSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAllowedFile, isServableInboxFile, sanitizeFileName, uniquePath } from "./file-guard.ts";

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

test("isServableInboxFile rejects traversal and symlink escape", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-inbox-"));
  const inbox = join(root, "inbox");
  const outside = join(root, "secret.txt");
  mkdirSync(inbox);
  writeFileSync(join(inbox, "photo.jpg"), "ok");
  writeFileSync(outside, "nope");
  symlinkSync(outside, join(inbox, "link.jpg"));
  mkdirSync(join(inbox, "subdir"));

  assert.equal(isServableInboxFile(inbox, join(inbox, "photo.jpg")), true);
  assert.equal(isServableInboxFile(inbox, outside), false);
  assert.equal(isServableInboxFile(inbox, join(inbox, "..", "secret.txt")), false);
  assert.equal(isServableInboxFile(inbox, join(inbox, "link.jpg")), false);
  assert.equal(isServableInboxFile(inbox, join(inbox, "subdir")), false);
  assert.equal(isServableInboxFile(inbox, join(inbox, "missing.jpg")), false);
  assert.equal(isServableInboxFile(inbox + "2", join(inbox, "photo.jpg")), false);
});

test("uniquePath keeps the reservation so concurrent callers get distinct names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-unique-"));
  const first = await uniquePath(dir, "note.txt");
  assert.equal(existsSync(first), true);
  const [a, b] = await Promise.all([uniquePath(dir, "note.txt"), uniquePath(dir, "note.txt")]);
  assert.notEqual(a, b);
  assert.notEqual(a, first);
  assert.notEqual(b, first);
  assert.equal(existsSync(a), true);
  assert.equal(existsSync(b), true);
});
