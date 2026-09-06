import assert from "node:assert/strict";
import test from "node:test";
import { stripTagPrefix, versionCodeFromName } from "./version.ts";

test("version code is monotonic and unique per semver", () => {
  assert.equal(versionCodeFromName("0.1.0"), 1_000);
  assert.equal(versionCodeFromName("1.2.3"), 1_002_003);
  assert.ok(versionCodeFromName("0.2.0") > versionCodeFromName("0.1.9"));
});

test("tag prefix is stripped", () => {
  assert.equal(stripTagPrefix("v0.1.0"), "0.1.0");
  assert.equal(stripTagPrefix("0.1.0"), "0.1.0");
});
