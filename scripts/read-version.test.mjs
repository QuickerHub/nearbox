import assert from "node:assert/strict";
import test from "node:test";
import { readPackageVersion, stripTagPrefix, versionCodeFromName } from "./read-version.mjs";

test("readPackageVersion returns the semver from package.json", () => {
  const version = readPackageVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.equal(version, "0.7.0");
});

test("versionCodeFromName is monotonic and unique per patch", () => {
  assert.equal(versionCodeFromName("0.1.0"), 1_000);
  assert.equal(versionCodeFromName("1.2.3"), 1_002_003);
  assert.ok(versionCodeFromName("0.2.0") > versionCodeFromName("0.1.9"));
  assert.ok(versionCodeFromName("0.7.1") > versionCodeFromName("0.7.0"));
});

test("stripTagPrefix drops a leading v", () => {
  assert.equal(stripTagPrefix("v0.7.0"), "0.7.0");
  assert.equal(stripTagPrefix("V1.2.3"), "1.2.3");
  assert.equal(stripTagPrefix("  0.7.0  "), "0.7.0");
  assert.equal(stripTagPrefix(""), "");
});
