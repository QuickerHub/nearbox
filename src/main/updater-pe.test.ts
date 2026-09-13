import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppUpdater } from "./updater.ts";
import { hasWindowsPeMzHeader } from "./updater-pe.ts";

test("hasWindowsPeMzHeader accepts MZ and rejects HTML/empty", () => {
  assert.equal(hasWindowsPeMzHeader(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), true);
  assert.equal(hasWindowsPeMzHeader(Buffer.from("<!DOCTYPE html>")), false);
  assert.equal(hasWindowsPeMzHeader(Buffer.from([0x4d])), false);
  assert.equal(hasWindowsPeMzHeader(Buffer.alloc(0)), false);
  assert.equal(hasWindowsPeMzHeader(Buffer.from([0x00, 0x00])), false);
});

function fakeBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

test("download rejects HTML bodies that are not PE images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-upd-pe-"));
  let launched: string | null = null;
  try {
    const updater = new AppUpdater({
      currentVersion: "0.7.0",
      packaged: true,
      cacheDir: dir,
      fetchImpl: async (url) => {
        if (String(url).includes("api.github.com")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.8.0",
              body: "notes",
              html_url: "https://github.com/QuickerHub/nearbox/releases/tag/v0.8.0",
              assets: [{ name: "Nearbox-0.8.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(fakeBody(Buffer.from("<!DOCTYPE html><html>rate limit</html>")), {
          status: 200,
          headers: { "Content-Length": "40" },
        });
      },
      onLaunchInstaller(path) {
        launched = path;
      },
    });
    await updater.check(true);
    updater.startInstall();
    const internals = updater as unknown as { installJob: Promise<void> | null };
    assert.ok(internals.installJob);
    await internals.installJob;
    const status = updater.status();
    assert.equal(launched, null);
    assert.match(status.error ?? "", /可执行文件|安装包/);
    assert.equal(status.downloading, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("download accepts an MZ-headed installer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-upd-mz-"));
  let launched: string | null = null;
  try {
    const payload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const updater = new AppUpdater({
      currentVersion: "0.7.0",
      packaged: true,
      cacheDir: dir,
      fetchImpl: async (url) => {
        if (String(url).includes("api.github.com")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.8.0",
              assets: [{ name: "Nearbox-0.8.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
            }),
            { status: 200 },
          );
        }
        return new Response(fakeBody(payload), {
          status: 200,
          headers: { "Content-Length": String(payload.length) },
        });
      },
      onLaunchInstaller(path) {
        launched = path;
      },
    });
    await updater.check(true);
    updater.startInstall();
    const internals = updater as unknown as { installJob: Promise<void> | null };
    await internals.installJob;
    assert.ok(launched);
    assert.equal(readFileSync(launched!).subarray(0, 2).toString("binary"), "MZ");
    assert.equal(updater.status().progress, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
