import assert from "node:assert/strict";
import test from "node:test";
import { isCheckFresh, isReleaseJsonTooLarge, MAX_RELEASE_JSON_BYTES } from "./updater-fresh.ts";

test("isCheckFresh rejects future / NaN timestamps so refresh is not suppressed forever", () => {
  const now = 1_000_000;
  const stale = 60_000;
  assert.equal(isCheckFresh(now - 1_000, now, stale), true);
  assert.equal(isCheckFresh(now - stale, now, stale), false);
  assert.equal(isCheckFresh(now + 60_000, now, stale), false);
  assert.equal(isCheckFresh(Number.NaN, now, stale), false);
  assert.equal(isCheckFresh(0, now, stale), false);
  assert.equal(isCheckFresh(-1, now, stale), false);
});

test("isReleaseJsonTooLarge enforces the release JSON ceiling", () => {
  assert.equal(isReleaseJsonTooLarge(0), false);
  assert.equal(isReleaseJsonTooLarge(MAX_RELEASE_JSON_BYTES), false);
  assert.equal(isReleaseJsonTooLarge(MAX_RELEASE_JSON_BYTES + 1), true);
  assert.equal(isReleaseJsonTooLarge(Number.NaN), true);
  assert.equal(isReleaseJsonTooLarge(-1), true);
});
