import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeInjectorCommands } from "./input-win.ts";

test("sanitizeInjectorCommands keeps grammar lines and drops smuggled ones", () => {
  assert.deepEqual(sanitizeInjectorCommands(["M 1 2", "B 1 1", "W -120", "K 65 1 0", "U 72"]), [
    "M 1 2",
    "B 1 1",
    "W -120",
    "K 65 1 0",
    "U 72",
  ]);
  const smuggled = "M 1 2" + "\n" + "B 1 1";
  assert.deepEqual(sanitizeInjectorCommands([smuggled, "RM -rf /", "K 65 1 0 9", ""]), []);
  assert.deepEqual(sanitizeInjectorCommands(["H 120", "not-a-command"]), ["H 120"]);
});
