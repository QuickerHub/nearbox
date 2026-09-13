import assert from "node:assert/strict";
import test from "node:test";
import { exceedsSshExecBudget, MAX_SSH_EXEC_BYTES } from "./ssh-exec-budget.ts";

test("exceedsSshExecBudget blocks helper output floods", () => {
  assert.equal(exceedsSshExecBudget(0, 100), false);
  assert.equal(exceedsSshExecBudget(MAX_SSH_EXEC_BYTES - 1, 1), false);
  assert.equal(exceedsSshExecBudget(MAX_SSH_EXEC_BYTES, 1), true);
  assert.equal(exceedsSshExecBudget(0, MAX_SSH_EXEC_BYTES + 1), true);
  assert.ok(MAX_SSH_EXEC_BYTES >= 1024 * 1024);
});
