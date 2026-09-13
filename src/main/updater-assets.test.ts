import assert from "node:assert/strict";
import test from "node:test";
import { isSafeReleaseAssetName, pickReleaseAssets } from "./updater.ts";

test("isSafeReleaseAssetName rejects path separators and traversal", () => {
  assert.equal(isSafeReleaseAssetName("Nearbox-1.0.0-win-x64.exe"), true);
  assert.equal(isSafeReleaseAssetName("win/../evil.exe"), false);
  assert.equal(isSafeReleaseAssetName("evil\\win.exe"), false);
  assert.equal(isSafeReleaseAssetName(""), false);
});

test("pickReleaseAssets skips null rows and pathy names", () => {
  const assets = pickReleaseAssets([
    null as unknown as { name: string; browser_download_url: string },
    { name: "win/../Nearbox.exe", browser_download_url: "https://example/bad.exe" },
    { name: "Nearbox-1.0.0-win-x64.exe", browser_download_url: "https://example/good.exe" },
    { name: "Nearbox-1.0.0-android.apk", browser_download_url: "https://example/good.apk" },
  ]);
  assert.equal(assets.exeUrl, "https://example/good.exe");
  assert.equal(assets.apkUrl, "https://example/good.apk");
});
