import assert from "node:assert/strict";
import test from "node:test";
import { pickReleaseAssets, statusFromRelease } from "./updater.ts";

test("Windows exe and Android apk are picked from a GitHub release", () => {
  const assets = pickReleaseAssets([
    { name: "Nearbox-0.6.0-win-x64.zip", browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/x.zip" },
    { name: "Nearbox-0.6.0-win-x64.exe", browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-win-x64.exe" },
    { name: "Nearbox-0.6.0-android.apk", browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-android.apk" },
  ]);
  assert.equal(assets.exeUrl, "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-win-x64.exe");
  assert.equal(assets.apkUrl, "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-android.apk");
});

test("a newer tag is reported as an update", () => {
  const status = statusFromRelease(
    {
      tag_name: "v0.6.0",
      html_url: "https://github.com/QuickerHub/nearbox/releases/tag/v0.6.0",
      body: "设置里可以直接更新。",
      assets: [{ name: "Nearbox-0.6.0-win-x64.exe", browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-win-x64.exe" }],
    },
    "0.5.0",
    true,
  );
  assert.equal(status.latest, "0.6.0");
  assert.equal(status.newer, true);
  assert.equal(status.exeUrl, "https://github.com/QuickerHub/nearbox/releases/download/v0.6.0/Nearbox-0.6.0-win-x64.exe");
  assert.equal(status.notes, "设置里可以直接更新。");
});

test("the same tag is not an update", () => {
  const status = statusFromRelease({ tag_name: "v0.6.0", assets: [] }, "0.6.0", true);
  assert.equal(status.newer, false);
});

test("non-string release body and untrusted htmlUrl do not crash statusFromRelease", () => {
  const status = statusFromRelease(
    {
      tag_name: { v: 1 } as unknown as string,
      html_url: "https://evil.example/pwn",
      body: { markdown: "x" } as unknown as string,
      assets: [{ name: "Nearbox.exe", browser_download_url: "https://evil.example/x.exe" }],
    },
    "0.5.0",
    true,
  );
  assert.equal(status.latest, null);
  assert.equal(status.newer, false);
  assert.equal(status.notes, "");
  assert.equal(status.htmlUrl, "https://github.com/QuickerHub/nearbox/releases/latest");
  assert.equal(status.exeUrl, null);
});
