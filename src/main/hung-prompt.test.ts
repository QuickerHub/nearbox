/**
 * Fake-ACP hung `session/prompt` smoke: agent ignores soft cancel and
 * `$/cancel_request`; warm-cancel timeline force + abandon finishes the turn
 * without Electron or a real AgentHost process.
 */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AcpConnection } from "./acp.ts";
import { CANCEL_GRACE_MS, FORCE_CANCEL_GRACE_MS } from "./cancel-escalation.ts";
import {
  abandonSessionPrompt,
  forceCancelSessionPrompt,
  softCancelSessionPrompt,
  type ControllablePrompt,
} from "./prompt-control.ts";
import { startWarmCancelOnHost, type WarmCancelHostSurface } from "./warm-cancel-host.ts";

function pipes() {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const connection = new AcpConnection(toAgent, fromAgent);
  const sent: Record<string, unknown>[] = [];
  toAgent.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      sent.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const agentSays = (message: unknown) => fromAgent.write(`${JSON.stringify(message)}\n`);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { connection, sent, agentSays, flush, fromAgent };
}

function fakeSchedule() {
  const queue: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  const schedule = (ms: number, fn: () => void) => {
    queue.push({ at: now + ms, fn });
    queue.sort((a, b) => a.at - b.at);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (queue.length && queue[0]!.at <= target) {
      const next = queue.shift()!;
      now = next.at;
      next.fn();
    }
    now = target;
  };
  return { schedule, advance };
}

/** Thin host surface over AcpConnection + prompt map (mirrors AgentHost cancel path). */
function hungPromptHost(connection: AcpConnection, prompts: Map<string, ControllablePrompt>) {
  let killed = false;
  const surface: WarmCancelHostSurface = {
    cancel(sessionId) {
      softCancelSessionPrompt(connection, prompts, sessionId);
    },
    forceCancel(sessionId) {
      forceCancelSessionPrompt(connection, prompts, sessionId);
    },
    abandonPrompt(sessionId) {
      abandonSessionPrompt(connection, prompts, sessionId);
    },
    kill() {
      killed = true;
      connection.close(new Error("host kill"));
    },
  };
  return {
    surface,
    wasKilled: () => killed,
    startHung(sessionId: string): Promise<unknown> {
      const out = { id: 0 };
      const pending = connection.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "hi" }] }, undefined, out);
      prompts.set(sessionId, { requestId: out.id });
      return pending.finally(() => {
        prompts.delete(sessionId);
      });
    },
  };
}

test("hung prompt ignores soft+force; abandon settles and sole-user kills", async () => {
  const { connection, sent, flush, agentSays } = pipes();
  const prompts = new Map<string, ControllablePrompt>();
  const host = hungPromptHost(connection, prompts);
  const { schedule, advance } = fakeSchedule();

  const pending = host.startHung("sess-hung");
  await flush();
  assert.equal(prompts.get("sess-hung")?.requestId, 1);
  assert.equal(sent[0]?.method, "session/prompt");

  let active = true;
  const notes: string[] = [];
  startWarmCancelOnHost(host.surface, "sess-hung", schedule, {
    settlePermissions() {
      notes.push("settle");
    },
    isStillActive: () => active,
    isSharedHost: () => false,
    onAbandonKeepHost() {
      notes.push("keep");
    },
    onForceCancel() {
      notes.push("force");
    },
  });

  assert.deepEqual(notes, ["settle"]);
  assert.ok(sent.some((message) => message.method === "session/cancel"));

  // Soft grace: agent still silent → force via $/cancel_request.
  advance(CANCEL_GRACE_MS);
  assert.deepEqual(notes, ["settle", "force"]);
  assert.ok(sent.some((message) => message.method === "$/cancel_request"));
  assert.equal(prompts.has("sess-hung"), true);

  // Force grace: still hung → local abandon + kill.
  advance(FORCE_CANCEL_GRACE_MS);
  assert.equal(host.wasKilled(), true);
  await assert.rejects(pending, /本轮已取消/);
  assert.equal(prompts.has("sess-hung"), false);

  // Late agent reply for the abandoned id must not throw or revive the turn.
  agentSays({ jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } });
  await flush();
  assert.equal(connection.isClosed, true);
});

test("hung prompt on shared host: abandon keeps process (no kill)", async () => {
  const { connection, flush } = pipes();
  const prompts = new Map<string, ControllablePrompt>();
  const host = hungPromptHost(connection, prompts);
  const { schedule, advance } = fakeSchedule();

  const pending = host.startHung("sess-share");
  await flush();

  let active = true;
  startWarmCancelOnHost(host.surface, "sess-share", schedule, {
    settlePermissions() {},
    isStillActive: () => active,
    isSharedHost: () => true,
    onAbandonKeepHost() {
      active = false;
    },
  });

  advance(CANCEL_GRACE_MS);
  assert.equal(host.wasKilled(), false);
  assert.equal(connection.isClosed, false);
  await assert.rejects(pending, /本轮已取消/);

  // Connection still usable for another session on the shared host.
  const next = connection.request("session/new", { cwd: "/tmp" });
  await flush();
  assert.ok(next);
  connection.close(new Error("done"));
  await assert.rejects(next, /done|已退出|已关闭/);
});
