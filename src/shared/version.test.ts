import assert from "node:assert/strict";
import test from "node:test";
import { isNewerVersion, shellVersionFromUserAgent, stripTagPrefix, tryVersionCode, versionCodeFromName } from "./version.ts";

test("version code is monotonic and unique per semver", () => {
  assert.equal(versionCodeFromName("0.1.0"), 1_000);
  assert.equal(versionCodeFromName("1.2.3"), 1_002_003);
  assert.ok(versionCodeFromName("0.2.0") > versionCodeFromName("0.1.9"));
});

test("tag prefix is stripped", () => {
  assert.equal(stripTagPrefix("v0.1.0"), "0.1.0");
  assert.equal(stripTagPrefix("0.1.0"), "0.1.0");
});

test("newer version compares semver, not strings", () => {
  assert.equal(isNewerVersion("0.6.0", "0.5.9"), true);
  assert.equal(isNewerVersion("0.5.0", "0.5.0"), false);
  assert.equal(isNewerVersion("0.5.10", "0.5.9"), true);
  assert.equal(isNewerVersion("not-a-version", "0.5.0"), false);
});

test("Android shell version is read from the user agent", () => {
  assert.equal(shellVersionFromUserAgent("Mozilla/5.0 NearboxShell/0.5.0"), "0.5.0");
  assert.equal(shellVersionFromUserAgent("Mozilla/5.0"), undefined);
});

test("tryVersionCode accepts v-prefixed tags and rejects garbage", () => {
  assert.equal(tryVersionCode("v1.2.3"), 1_002_003);
  assert.equal(tryVersionCode(" 0.7.0 "), 7_000);
  assert.equal(tryVersionCode("not-a-version"), null);
  assert.equal(tryVersionCode(""), null);
});

test("versionCodeFromName throws on non-semver", () => {
  assert.throws(() => versionCodeFromName("1.2"), /版本号必须是 semver/);
  assert.throws(() => versionCodeFromName("abc"), /版本号必须是 semver/);
});

test("shellVersionFromUserAgent reads the first semver after the marker", () => {
  // Suffixes after patch are ignored by the capture group; the digits still match.
  assert.equal(shellVersionFromUserAgent("NearboxShell/0.7.0-dev"), "0.7.0");
  assert.equal(shellVersionFromUserAgent("NearboxShell/0.7.0 other"), "0.7.0");
  assert.equal(shellVersionFromUserAgent("NearboxShell/0.7"), undefined);
});
