import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clampProgress, pickReleaseAssets, pruneOldInstallers, statusFromRelease } from "./updater.ts";

test("Windows exe and Android apk are picked from a GitHub release", () => {
  const assets = pickReleaseAssets([
    { name: "Nearbox-0.6.0-win-x64.zip", browser_download_url: "https://example/x.zip" },
    { name: "Nearbox-0.6.0-win-x64.exe", browser_download_url: "https://example/x.exe" },
    { name: "Nearbox-0.6.0-android.apk", browser_download_url: "https://example/x.apk" },
  ]);
  assert.equal(assets.exeUrl, "https://example/x.exe");
  assert.equal(assets.apkUrl, "https://example/x.apk");
});

test("a newer tag is reported as an update", () => {
  const status = statusFromRelease(
    {
      tag_name: "v0.6.0",
      html_url: "https://github.com/QuickerHub/nearbox/releases/tag/v0.6.0",
      body: "设置里可以直接更新。",
      assets: [{ name: "Nearbox-0.6.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
    },
    "0.5.0",
    true,
  );
  assert.equal(status.latest, "0.6.0");
  assert.equal(status.newer, true);
  assert.equal(status.exeUrl, "https://example/x.exe");
  assert.equal(status.notes, "设置里可以直接更新。");
});

test("the same tag is not an update", () => {
  const status = statusFromRelease({ tag_name: "v0.6.0", assets: [] }, "0.6.0", true);
  assert.equal(status.newer, false);
});

test("clampProgress keeps values in unit interval", () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(Number.NaN), 0);
  assert.equal(clampProgress(0.25), 0.25);
  assert.equal(clampProgress(1.5), 1);
});

test("pruneOldInstallers keeps only the current exe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-updater-prune-"));
  try {
    const keep = join(dir, "Nearbox-0.7.0-win-x64.exe");
    const old = join(dir, "Nearbox-0.6.0-win-x64.exe");
    writeFileSync(keep, "new");
    writeFileSync(old, "old");
    writeFileSync(join(dir, "notes.txt"), "keep");
    await pruneOldInstallers(dir, keep);
    assert.equal(existsSync(keep), true);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(join(dir, "notes.txt")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
