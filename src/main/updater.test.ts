import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppUpdater, DEFAULT_RELEASE_REPO, pickReleaseAssets, statusFromRelease } from "./updater.ts";

function waitFor(predicate: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > 3000) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

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

test("pickReleaseAssets falls back to any .exe when no win-named asset exists", () => {
  const assets = pickReleaseAssets([
    { name: "notes.zip", browser_download_url: "https://example/notes.zip" },
    { name: "NearboxSetup.exe", browser_download_url: "https://example/setup.exe" },
  ]);
  assert.equal(assets.exeUrl, "https://example/setup.exe");
  assert.equal(assets.apkUrl, null);
});

test("AppUpdater.status returns a shallow copy", () => {
  const updater = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: false,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () => new Response("{}", { status: 500 }),
    onLaunchInstaller() {},
  });
  const a = updater.status();
  const b = updater.status();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  a.notes = "mutated";
  assert.equal(updater.status().notes, "");
});

test("AppUpdater.check uses an injected repo slug in the releases URL", async () => {
  const urls: string[] = [];
  const updater = new AppUpdater({
    currentVersion: "0.6.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    repo: "acme/fork",
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ tag_name: "v0.6.0", assets: [] }), { status: 200 });
    },
    onLaunchInstaller() {},
  });
  await updater.check(true);
  assert.equal(urls[0], "https://api.github.com/repos/acme/fork/releases/latest");
  assert.equal(DEFAULT_RELEASE_REPO, "QuickerHub/nearbox");
});

test("AppUpdater.startInstall refuses when already latest, missing exe, or unpackaged", async () => {
  const upToDate = new AppUpdater({
    currentVersion: "0.7.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.7.0",
          assets: [{ name: "Nearbox-0.7.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
        }),
        { status: 200 },
      ),
    onLaunchInstaller() {},
  });
  await upToDate.check(true);
  upToDate.startInstall();
  await waitFor(() => Boolean(upToDate.status().error), "up-to-date error");
  assert.match(upToDate.status().error ?? "", /已经是最新版本/);

  const noExe = new AppUpdater({
    currentVersion: "0.6.0",
    packaged: true,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () =>
      new Response(JSON.stringify({ tag_name: "v0.7.0", assets: [{ name: "notes.zip", browser_download_url: "https://example/z" }] }), {
        status: 200,
      }),
    onLaunchInstaller() {},
  });
  await noExe.check(true);
  noExe.startInstall();
  await waitFor(() => Boolean(noExe.status().error), "missing exe error");
  assert.match(noExe.status().error ?? "", /没有 Windows 安装包/);

  const unpackaged = new AppUpdater({
    currentVersion: "0.6.0",
    packaged: false,
    cacheDir: "/tmp/nearbox-updater-unused",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.7.0",
          assets: [{ name: "Nearbox-0.7.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
        }),
        { status: 200 },
      ),
    onLaunchInstaller() {},
  });
  await unpackaged.check(true);
  unpackaged.startInstall();
  await waitFor(() => Boolean(unpackaged.status().error), "unpackaged error");
  assert.match(unpackaged.status().error ?? "", /开发中的版本/);
});

test("AppUpdater.startInstall downloads once, launches, and reuses the ready installer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-updater-dl-"));
  const launched: string[] = [];
  let downloadFetches = 0;
  try {
    const updater = new AppUpdater({
      currentVersion: "0.6.0",
      packaged: true,
      cacheDir: dir,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.7.0",
              assets: [
                {
                  name: "Nearbox-0.7.0-win-x64.exe",
                  browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.7.0/Nearbox-0.7.0-win-x64.exe",
                },
              ],
            }),
            { status: 200 },
          );
        }
        downloadFetches += 1;
        return new Response(Uint8Array.from([0x4d, 0x5a, 0x00, 0x01]), {
          status: 200,
          headers: { "content-length": "4" },
        });
      },
      onLaunchInstaller(filePath) {
        launched.push(filePath);
      },
    });

    await updater.check(true);
    assert.equal(updater.status().newer, true);
    updater.startInstall();
    await waitFor(() => launched.length === 1, "first launch");
    const first = launched[0]!;
    assert.match(first.replaceAll("\\", "/"), /Nearbox-0\.7\.0-win-x64\.exe$/);
    assert.equal(existsSync(first), true);
    assert.deepEqual(Uint8Array.from(readFileSync(first)), Uint8Array.from([0x4d, 0x5a, 0x00, 0x01]));
    assert.equal(updater.status().downloading, false);
    assert.equal(updater.status().progress, 1);
    assert.equal(downloadFetches, 1);

    updater.startInstall();
    await waitFor(() => launched.length === 2, "second launch");
    assert.equal(launched[1], first);
    assert.equal(downloadFetches, 1, "ready installer must be reused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AppUpdater.startInstall shares one in-flight install job", async () => {
  let release!: (value: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let downloadFetches = 0;
  const launched: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "nearbox-updater-inflight-"));
  try {
    const updater = new AppUpdater({
      currentVersion: "0.6.0",
      packaged: true,
      cacheDir: dir,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.7.0",
              assets: [
                {
                  name: "Nearbox-0.7.0-win-x64.exe",
                  browser_download_url: "https://github.com/QuickerHub/nearbox/releases/download/v0.7.0/x.exe",
                },
              ],
            }),
            { status: 200 },
          );
        }
        downloadFetches += 1;
        return gate;
      },
      onLaunchInstaller(filePath) {
        launched.push(filePath);
      },
    });
    await updater.check(true);
    updater.startInstall();
    await waitFor(() => downloadFetches === 1, "download started");
    updater.startInstall();
    assert.equal(downloadFetches, 1, "second startInstall must share the job");
    release(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3" },
      }),
    );
    await waitFor(() => launched.length === 1, "inflight launch");
    assert.equal(downloadFetches, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
