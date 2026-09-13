import assert from "node:assert/strict";
import test from "node:test";
import { emptyUpdateStatus, pickReleaseAssets, statusFromRelease } from "./updater.ts";

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

test("emptyUpdateStatus is the idle chip shape", () => {
  const status = emptyUpdateStatus("0.7.0", false);
  assert.equal(status.current, "0.7.0");
  assert.equal(status.latest, null);
  assert.equal(status.newer, false);
  assert.equal(status.notes, "");
  assert.equal(status.exeUrl, null);
  assert.equal(status.apkUrl, null);
  assert.equal(status.packaged, false);
  assert.equal(status.checking, false);
  assert.equal(status.downloading, false);
  assert.equal(status.progress, 0);
  assert.match(status.htmlUrl, /releases\/latest/);
});

test("statusFromRelease trims notes and tolerates missing assets or tags", () => {
  const long = "字".repeat(500);
  const status = statusFromRelease({ tag_name: "v0.7.1", body: `  ${long}  `, assets: undefined }, "0.7.0", true);
  assert.equal(status.latest, "0.7.1");
  assert.equal(status.newer, true);
  assert.equal(status.notes.length, 400);
  assert.equal(status.exeUrl, null);
  assert.equal(status.apkUrl, null);

  const noTag = statusFromRelease({ html_url: "https://example/releases", assets: [] }, "0.7.0", true);
  assert.equal(noTag.latest, null);
  assert.equal(noTag.newer, false);
  assert.equal(noTag.htmlUrl, "https://example/releases");
});

test("pickReleaseAssets prefers a Windows-named exe when several exist", () => {
  const assets = pickReleaseAssets([
    { name: "helper.exe", browser_download_url: "https://example/helper.exe" },
    { name: "Nearbox-0.7.0-win-x64.exe", browser_download_url: "https://example/win.exe" },
    { name: "Nearbox-0.7.0.apk", browser_download_url: "https://example/app.apk" },
  ]);
  assert.equal(assets.exeUrl, "https://example/win.exe");
  assert.equal(assets.apkUrl, "https://example/app.apk");
  assert.deepEqual(pickReleaseAssets(undefined), { exeUrl: null, apkUrl: null });
});
