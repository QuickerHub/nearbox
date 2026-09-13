import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLatestTag, sanitizeInstallerVersion } from "./updater-version.ts";

test("sanitizeInstallerVersion strips Windows-illegal filename characters", () => {
  assert.equal(sanitizeInstallerVersion("1.0.0"), "1.0.0");
  assert.equal(sanitizeInstallerVersion("v1.2.3"), "1.2.3");
  assert.equal(sanitizeInstallerVersion("1.0.0:rc1"), "1.0.0-rc1");
  assert.equal(sanitizeInstallerVersion("1.0.0/../../evil"), "1.0.0-evil");
  assert.equal(sanitizeInstallerVersion("a<b>|c?*"), "a-b-c");
  assert.equal(sanitizeInstallerVersion("   "), null);
  assert.equal(sanitizeInstallerVersion("v"), null);
});

test("normalizeLatestTag rejects non-strings and empty tags", () => {
  assert.equal(normalizeLatestTag("v0.7.0"), "0.7.0");
  assert.equal(normalizeLatestTag(""), null);
  assert.equal(normalizeLatestTag("v"), null);
  assert.equal(normalizeLatestTag(1), null);
  assert.equal(normalizeLatestTag(null), null);
});
