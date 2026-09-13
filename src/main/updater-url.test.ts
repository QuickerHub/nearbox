import assert from "node:assert/strict";
import test from "node:test";
import { isGithubReleasePayload, isTrustedInstallerUrl } from "./updater-url.ts";

test("installer URLs must be https GitHub (or objects.githubusercontent.com)", () => {
  assert.equal(isTrustedInstallerUrl("https://github.com/QuickerHub/nearbox/releases/download/v1/x.exe"), true);
  assert.equal(isTrustedInstallerUrl("https://objects.githubusercontent.com/github-production-release-asset-2e65be/x"), true);
  assert.equal(isTrustedInstallerUrl("https://release-assets.githubusercontent.com/x"), true);
  assert.equal(isTrustedInstallerUrl("http://github.com/QuickerHub/nearbox/releases/download/v1/x.exe"), false);
  assert.equal(isTrustedInstallerUrl("https://evil.example/x.exe"), false);
  assert.equal(isTrustedInstallerUrl("file:///tmp/Nearbox.exe"), false);
  assert.equal(isTrustedInstallerUrl("not a url"), false);
});

test("release JSON must be a non-array object", () => {
  assert.equal(isGithubReleasePayload({ tag_name: "v1" }), true);
  assert.equal(isGithubReleasePayload(null), false);
  assert.equal(isGithubReleasePayload([]), false);
  assert.equal(isGithubReleasePayload("v1"), false);
});
