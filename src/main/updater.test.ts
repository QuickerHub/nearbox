import assert from "node:assert/strict";
import test from "node:test";
import { AppUpdater, DEFAULT_RELEASE_REPO, pickReleaseAssets, statusFromRelease } from "./updater.ts";

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

test("DEFAULT_RELEASE_REPO is the public QuickerHub project", () => {
  assert.equal(DEFAULT_RELEASE_REPO, "QuickerHub/nearbox");
});

test("AppUpdater.check fetches the latest release through the injected fetch", async () => {
  const urls: string[] = [];
  const updater = new AppUpdater({
    currentVersion: "0.6.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    now: () => Date.parse("2026-09-13T12:00:00.000Z"),
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          tag_name: "v0.7.0",
          html_url: "https://github.com/QuickerHub/nearbox/releases/tag/v0.7.0",
          body: "  round 7  ",
          assets: [
            { name: "Nearbox-0.7.0-win-x64.exe", browser_download_url: "https://example/0.7.exe" },
            { name: "Nearbox-0.7.0-android.apk", browser_download_url: "https://example/0.7.apk" },
          ],
        }),
        { status: 200 },
      );
    },
    onLaunchInstaller() {},
  });

  const status = await updater.check(true);
  assert.equal(status.latest, "0.7.0");
  assert.equal(status.newer, true);
  assert.equal(status.exeUrl, "https://example/0.7.exe");
  assert.equal(status.apkUrl, "https://example/0.7.apk");
  assert.equal(status.notes, "round 7");
  assert.equal(status.checking, false);
  assert.match(status.checkedAt ?? "", /^2026-09-13T12:00:00/);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], `https://api.github.com/repos/${DEFAULT_RELEASE_REPO}/releases/latest`);
});

test("AppUpdater.check reuses a fresh snapshot until forced or stale", async () => {
  let fetches = 0;
  let now = Date.parse("2026-09-13T12:00:00.000Z");
  const updater = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: false,
    cacheDir: "/tmp/nearbox-updater-unused",
    now: () => now,
    fetchImpl: async () => {
      fetches += 1;
      return new Response(JSON.stringify({ tag_name: "v0.7.0", assets: [] }), { status: 200 });
    },
    onLaunchInstaller() {},
  });

  await updater.check(true);
  assert.equal(fetches, 1);
  now += 60_000;
  await updater.check(false);
  assert.equal(fetches, 1);
  now += 60 * 60 * 1000;
  await updater.check(false);
  assert.equal(fetches, 2);
  await updater.check(true);
  assert.equal(fetches, 3);
});

test("AppUpdater.check records Chinese errors for GitHub failures", async () => {
  const forbidden = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () => new Response("rate limit", { status: 403 }),
    onLaunchInstaller() {},
  });
  const denied = await forbidden.check(true);
  assert.match(denied.error ?? "", /GitHub 查询次数用完了/);
  assert.equal(denied.checking, false);

  const broken = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () => new Response("nope", { status: 500 }),
    onLaunchInstaller() {},
  });
  const failed = await broken.check(true);
  assert.match(failed.error ?? "", /无法检查更新（500）/);
});

test("AppUpdater.check shares one in-flight refresh across callers", async () => {
  let fetches = 0;
  let release!: (value: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const updater = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () => {
      fetches += 1;
      return gate;
    },
    onLaunchInstaller() {},
  });

  const first = updater.check(true);
  const second = updater.check(true);
  assert.equal(fetches, 1);
  release(new Response(JSON.stringify({ tag_name: "v0.7.1", assets: [] }), { status: 200 }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.latest, "0.7.1");
  assert.equal(b.latest, "0.7.1");
  assert.equal(fetches, 1);
});
