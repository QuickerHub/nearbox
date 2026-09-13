import assert from "node:assert/strict";
import test from "node:test";
import { coerceRunStatus, isValidRunStatus } from "./store-status.ts";

test("coerceRunStatus keeps the closed RunStatus set and fails closed", () => {
  assert.equal(coerceRunStatus("succeeded"), "succeeded");
  assert.equal(coerceRunStatus("queued"), "queued");
  assert.equal(isValidRunStatus("running"), true);
  assert.equal(coerceRunStatus("RUNNING"), "failed");
  assert.equal(coerceRunStatus(""), "failed");
  assert.equal(coerceRunStatus(null), "failed");
  assert.equal(coerceRunStatus(undefined), "failed");
  assert.equal(coerceRunStatus(1), "failed");
});
