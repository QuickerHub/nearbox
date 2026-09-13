import assert from "node:assert/strict";
import test from "node:test";
import {
  isInstallerTooLarge,
  isTrustedInstallerUrl,
  isTrustedReleasePageUrl,
  releaseHtmlUrl,
  releaseNotes,
  releaseTagName,
  sanitizeReleaseAssets,
} from "./updater-release.ts";

test("release page URLs must be https github.com", () => {
  assert.equal(isTrustedReleasePageUrl("https://github.com/QuickerHub/nearbox/releases/tag/v1"), true);
  assert.equal(isTrustedReleasePageUrl("https://evil.com/x"), false);
  assert.equal(isTrustedReleasePageUrl("http://github.com/x"), false);
  assert.equal(isTrustedReleasePageUrl("javascript:alert(1)"), false);
});

test("installer URLs stay on GitHub HTTPS hosts", () => {
  assert.equal(isTrustedInstallerUrl("https://github.com/org/repo/releases/download/v1/a.exe"), true);
  assert.equal(isTrustedInstallerUrl("https://objects.githubusercontent.com/a.exe"), true);
  assert.equal(isTrustedInstallerUrl("https://evil.com/a.exe"), false);
});

test("release field helpers reject non-strings", () => {
  assert.equal(releaseTagName("v1.2.3"), "v1.2.3");
  assert.equal(releaseTagName({ name: "v1" }), undefined);
  assert.equal(releaseNotes({ text: "x" }), "");
  assert.equal(releaseNotes("  hello  "), "hello");
  assert.equal(releaseHtmlUrl("https://evil.com/r", "https://github.com/QuickerHub/nearbox/releases/latest"), "https://github.com/QuickerHub/nearbox/releases/latest");
  assert.equal(releaseHtmlUrl("https://github.com/QuickerHub/nearbox/releases/tag/v1", "fallback"), "https://github.com/QuickerHub/nearbox/releases/tag/v1");
});

test("sanitizeReleaseAssets drops bad rows and untrusted URLs", () => {
  const assets = sanitizeReleaseAssets([
    { name: "Nearbox-1.exe", browser_download_url: "https://github.com/a/b/releases/download/v1/Nearbox-1.exe" },
    { name: "evil.exe", browser_download_url: "https://evil.com/x.exe" },
    { name: 1, browser_download_url: "https://github.com/a/b/x.exe" },
    null,
  ]);
  assert.equal(assets.length, 1);
  assert.match(assets[0]!.browser_download_url, /github\.com/);
});

test("installer size ceiling rejects absurd Content-Length", () => {
  assert.equal(isInstallerTooLarge(1024), false);
  assert.equal(isInstallerTooLarge(513 * 1024 * 1024), true);
  assert.equal(isInstallerTooLarge(Number.NaN), true);
});
