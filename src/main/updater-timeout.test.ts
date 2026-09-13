import assert from "node:assert/strict";
import test from "node:test";
import { UPDATE_CHECK_TIMEOUT_MS, UPDATE_DOWNLOAD_TIMEOUT_MS } from "./updater.ts";

test("update fetch timeouts are positive finite budgets", () => {
  assert.ok(UPDATE_CHECK_TIMEOUT_MS >= 5_000);
  assert.ok(UPDATE_DOWNLOAD_TIMEOUT_MS >= UPDATE_CHECK_TIMEOUT_MS);
  assert.ok(Number.isFinite(UPDATE_CHECK_TIMEOUT_MS));
  assert.ok(Number.isFinite(UPDATE_DOWNLOAD_TIMEOUT_MS));
});
