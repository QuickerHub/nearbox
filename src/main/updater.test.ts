import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AppUpdater,
  installerFileName,
  installerPath,
  pickReleaseAssets,
  sanitizeInstallerVersion,
  statusFromRelease,
} from "./updater.ts";

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

test("sanitizeInstallerVersion strips path separators so installers stay in cacheDir", () => {
  assert.equal(sanitizeInstallerVersion("0.7.0"), "0.7.0");
  assert.equal(sanitizeInstallerVersion("v1.2.3"), "v1.2.3");
  assert.equal(sanitizeInstallerVersion("1.0.0/../../evil"), "1.0.0_.._.._evil");
  assert.equal(sanitizeInstallerVersion("   "), "unknown");
  assert.equal(installerFileName("1.0.0/../../evil"), "Nearbox-1.0.0_.._.._evil-win-x64.exe");
  const dest = installerPath("/tmp/cache", "1.0.0/../../evil");
  assert.equal(dest, "/tmp/cache/Nearbox-1.0.0_.._.._evil-win-x64.exe");
  assert.equal(dest.includes("/"), true); // only the cacheDir separators
  assert.equal(dest.startsWith("/tmp/cache/"), true);
  assert.equal(dest.includes("/../"), false);
});

test("download rejects incomplete bodies and leaves no ready exe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-updater-incomplete-"));
  try {
    const updater = new AppUpdater({
      currentVersion: "0.5.0",
      packaged: true,
      cacheDir: dir,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.6.0",
              assets: [{ name: "Nearbox-0.6.0-win-x64.exe", browser_download_url: "https://example.test/app.exe" }],
            }),
            { status: 200 },
          );
        }
        const bytes = new Uint8Array([1, 2, 3, 4]);
        return new Response(bytes, {
          status: 200,
          headers: { "content-length": "100" },
        });
      },
      onLaunchInstaller() {
        assert.fail("should not launch a truncated installer");
      },
    });
    await updater.check(true);
    // Hook the private installJob finally by calling startInstall and polling error.
    updater.startInstall();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const snap = updater.status();
      if (snap.error) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const snap = updater.status();
    assert.match(String(snap.error ?? ""), /不完整/);
    assert.equal(existsSync(join(dir, "Nearbox-0.6.0-win-x64.exe")), false);
    assert.equal(existsSync(join(dir, "Nearbox-0.6.0-win-x64.exe.partial")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
