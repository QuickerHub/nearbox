import assert from "node:assert/strict";
import test from "node:test";
import { isPersistedStateRoot, runNeedsPersistAfterLoad } from "./store-load.ts";
import { FLUSH_RETRY_MAX_MS, FLUSH_RETRY_MIN_MS, nextFlushRetryDelay } from "./store-retry.ts";

test("isPersistedStateRoot rejects arrays strings and null", () => {
  assert.equal(isPersistedStateRoot({ version: 1 }), true);
  assert.equal(isPersistedStateRoot([]), false);
  assert.equal(isPersistedStateRoot("nope"), false);
  assert.equal(isPersistedStateRoot(null), false);
  assert.equal(isPersistedStateRoot(1), false);
});

test("runNeedsPersistAfterLoad flags crash and permission leftovers", () => {
  assert.equal(
    runNeedsPersistAfterLoad({ status: "running" }, { status: "failed", eventCount: 0 }),
    true,
  );
  assert.equal(
    runNeedsPersistAfterLoad({ status: "succeeded", pendingPermission: { id: "x" } }, { status: "succeeded", eventCount: 0 }),
    true,
  );
  assert.equal(
    runNeedsPersistAfterLoad({ status: "succeeded", parentRunId: "" }, { status: "succeeded", eventCount: 0 }),
    true,
  );
  assert.equal(
    runNeedsPersistAfterLoad({ status: "succeeded" }, { status: "succeeded", eventCount: 0 }),
    true,
  );
  assert.equal(
    runNeedsPersistAfterLoad({ status: "succeeded", eventCount: 3 }, { status: "succeeded", eventCount: 3 }),
    false,
  );
});

test("nextFlushRetryDelay doubles up to the cap", () => {
  assert.equal(nextFlushRetryDelay(0), FLUSH_RETRY_MIN_MS * 2);
  assert.equal(nextFlushRetryDelay(FLUSH_RETRY_MIN_MS), FLUSH_RETRY_MIN_MS * 2);
  assert.equal(nextFlushRetryDelay(FLUSH_RETRY_MAX_MS), FLUSH_RETRY_MAX_MS);
  assert.equal(nextFlushRetryDelay(8_000), FLUSH_RETRY_MAX_MS);
});
