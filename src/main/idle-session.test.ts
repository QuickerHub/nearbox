import assert from "node:assert/strict";
import test from "node:test";
import { MAX_LOADED_SESSIONS, sessionsToPrune, shouldCloseSessionsBeforeIdleKill } from "./idle-session.ts";

test("sessionsToPrune keeps under max and never closes busy or keepId", () => {
  const loaded = [
    { sessionId: "a", lastUsedAt: 1 },
    { sessionId: "b", lastUsedAt: 2 },
    { sessionId: "c", lastUsedAt: 3 },
    { sessionId: "d", lastUsedAt: 4 },
    { sessionId: "e", lastUsedAt: 5 },
  ];
  assert.deepEqual(sessionsToPrune(loaded, { max: 4 }), ["a"]);
  assert.deepEqual(sessionsToPrune(loaded, { keepId: "a", max: 4 }), ["b"]);
  assert.deepEqual(
    sessionsToPrune(loaded, { keepId: "e", busyIds: new Set(["a", "b"]), max: 4 }),
    ["c"],
  );
  assert.deepEqual(sessionsToPrune(loaded.slice(0, 3), { max: MAX_LOADED_SESSIONS }), []);
  // All protected: nothing to prune even when over max.
  assert.deepEqual(
    sessionsToPrune(loaded, { busyIds: new Set(["a", "b", "c", "d", "e"]), max: 2 }),
    [],
  );
});

test("shouldCloseSessionsBeforeIdleKill requires capability and loaded sessions", () => {
  assert.equal(shouldCloseSessionsBeforeIdleKill(true, 2), true);
  assert.equal(shouldCloseSessionsBeforeIdleKill(true, 0), false);
  assert.equal(shouldCloseSessionsBeforeIdleKill(false, 3), false);
});
