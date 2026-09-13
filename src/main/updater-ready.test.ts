import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppUpdater } from "./updater.ts";

test("refresh clears a remembered installer when the cache file was deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-upd-ready-"));
  try {
    const file = join(dir, "Nearbox-0.8.0-win-x64.exe");
    writeFileSync(file, "exe");
    let now = 1_000_000;
    const updater = new AppUpdater({
      currentVersion: "0.7.0",
      packaged: true,
      cacheDir: dir,
      now: () => now,
      onLaunchInstaller() {
        /* unused */
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.8.0",
            html_url: "https://example/r",
            body: "notes",
            assets: [{ name: "Nearbox-0.8.0-win-x64.exe", browser_download_url: "https://example/x.exe" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    // Seed an in-memory "already downloaded" marker, then delete the file.
    (updater as unknown as { readyFile: string; readyVersion: string }).readyFile = file;
    (updater as unknown as { readyFile: string; readyVersion: string }).readyVersion = "0.8.0";
    rmSync(file);
    const status = await updater.check(true);
    assert.equal(status.progress, 0);
    assert.equal(status.latest, "0.8.0");
    assert.equal(status.newer, true);
    now += 60 * 60 * 1000 + 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
