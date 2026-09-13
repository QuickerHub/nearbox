import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertAllowedFile, sanitizeFileName, uniquePath } from "./file-guard.ts";

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

test("uniquePath keeps exclusive reservations so concurrent names do not collide", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nearbox-unique-"));
  try {
    const paths = await Promise.all(Array.from({ length: 20 }, () => uniquePath(dir, "shot.png")));
    assert.equal(new Set(paths).size, 20);
    const names = new Set(await readdir(dir));
    assert.equal(names.size, 20);
    assert.ok(names.has("shot.png"));
    assert.ok(paths.every((item) => names.has(basename(item))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
