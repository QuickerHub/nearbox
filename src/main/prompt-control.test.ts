import assert from "node:assert/strict";
import test from "node:test";
import {
  abandonSessionPrompt,
  forceCancelSessionPrompt,
  softCancelSessionPrompt,
  type ControllablePrompt,
  type PromptControlConnection,
} from "./prompt-control.ts";

function fakeConnection() {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const pending = new Map<number, Error | null>();
  const connection: PromptControlConnection = {
    notify(method, params) {
      calls.push({ kind: `notify:${method}`, payload: params });
    },
    cancelRequest(id) {
      calls.push({ kind: "cancelRequest", payload: id });
    },
    rejectPending(id, error) {
      calls.push({ kind: "rejectPending", payload: { id, message: error.message } });
      if (!pending.has(id)) {
        return false;
      }
      pending.delete(id);
      return true;
    },
  };
  return { connection, calls, pending };
}

test("soft cancel notifies only while a prompt slot exists", () => {
  const { connection, calls } = fakeConnection();
  const prompts = new Map<string, ControllablePrompt>();
  softCancelSessionPrompt(connection, prompts, "s1");
  assert.deepEqual(calls, []);
  prompts.set("s1", { requestId: 7 });
  softCancelSessionPrompt(connection, prompts, "s1");
  assert.deepEqual(calls, [{ kind: "notify:session/cancel", payload: { sessionId: "s1" } }]);
});

test("force cancel sends $/cancel_request for the slot's request id", () => {
  const { connection, calls } = fakeConnection();
  const prompts = new Map<string, ControllablePrompt>([["s1", { requestId: 42 }]]);
  forceCancelSessionPrompt(connection, prompts, "missing");
  forceCancelSessionPrompt(connection, prompts, "s1");
  assert.deepEqual(calls, [{ kind: "cancelRequest", payload: 42 }]);
  assert.equal(prompts.has("s1"), true);
});

test("abandon rejects pending, clears the slot, and is idempotent", () => {
  const { connection, calls, pending } = fakeConnection();
  pending.set(9, null);
  const prompts = new Map<string, ControllablePrompt>([["s1", { requestId: 9 }]]);
  assert.equal(abandonSessionPrompt(connection, prompts, "s1"), true);
  assert.equal(prompts.has("s1"), false);
  assert.equal(abandonSessionPrompt(connection, prompts, "s1"), false);
  assert.deepEqual(calls, [{ kind: "rejectPending", payload: { id: 9, message: "本轮已取消" } }]);
});
