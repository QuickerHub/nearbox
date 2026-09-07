import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AcpConnection, type AcpModel, choosePermission, mapCursorModel, RpcError, type RpcIncomingRequest } from "./acp.ts";

/** A fake agent on the other end of the pipes. */
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

test("requests are numbered, answered by id, and errors carry the agent's detail", async () => {
  const { connection, sent, agentSays, flush } = pipes();
  const first = connection.request("initialize", { protocolVersion: 1 });
  const second = connection.request("session/set_model", { modelId: "x" });
  await flush();
  assert.deepEqual(sent.map((message) => [message.id, message.method]), [
    [1, "initialize"],
    [2, "session/set_model"],
  ]);
  agentSays({ jsonrpc: "2.0", id: 2, error: { code: -32602, message: "Invalid params", data: { message: "Invalid model value: x" } } });
  agentSays({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } });
  assert.deepEqual(await first, { protocolVersion: 1 });
  await assert.rejects(second, (error: unknown) => error instanceof RpcError && error.code === -32602 && error.message === "Invalid model value: x");
});

test("notifications and incoming requests are surfaced; responses go back with the same id", async () => {
  const { connection, sent, agentSays, flush } = pipes();
  const notifications: [string, unknown][] = [];
  const requests: RpcIncomingRequest[] = [];
  connection.on("notification", (method: string, params: unknown) => notifications.push([method, params]));
  connection.on("request", (request: RpcIncomingRequest) => {
    requests.push(request);
    connection.respond(request.id, { outcome: { outcome: "selected", optionId: "allow-once" } });
  });
  agentSays({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk" } } });
  agentSays({ jsonrpc: "2.0", id: "req-7", method: "session/request_permission", params: { sessionId: "s", options: [] } });
  agentSays("not json at all");
  await flush();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.[0], "session/update");
  assert.equal(requests[0]?.method, "session/request_permission");
  assert.deepEqual(sent, [{ jsonrpc: "2.0", id: "req-7", result: { outcome: { outcome: "selected", optionId: "allow-once" } } }]);
});

test("closing the connection fails every pending request", async () => {
  const { connection, fromAgent } = pipes();
  const pending = connection.request("session/prompt", {});
  fromAgent.end();
  await assert.rejects(pending, /Agent 进程已退出/);
  await assert.rejects(connection.request("session/new", {}), /已关闭/);
});

test("permission policy: full access allows, safe mode asks before commands", () => {
  const options = [
    { optionId: "allow-once", kind: "allow_once" },
    { optionId: "allow-always", kind: "allow_always" },
    { optionId: "reject-once", kind: "reject_once" },
  ];
  assert.deepEqual(choosePermission("full", { kind: "execute" }, options), { action: "select", optionId: "allow-once", rejected: false });
  assert.deepEqual(choosePermission("safe", { kind: "execute" }, options), { action: "ask" });
  assert.deepEqual(choosePermission("safe", { kind: "edit" }, options), { action: "select", optionId: "allow-once", rejected: false });
  // Some CLIs only offer "always"; full access still has to pick it or every command dies.
  assert.deepEqual(choosePermission("full", { kind: "execute" }, [{ optionId: "x", kind: "allow_always" }]), { action: "select", optionId: "x", rejected: false });
});

const PRESETS: AcpModel[] = [
  { modelId: "default[]", name: "Auto" },
  { modelId: "grok-4.6[effort=high,fast=true]", name: "grok-4.6" },
  { modelId: "composer-2.5[fast=true]", name: "composer-2.5" },
  { modelId: "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]", name: "claude-opus-5" },
  { modelId: "gpt-5.3-codex[reasoning=medium,fast=false]", name: "gpt-5.3-codex" },
  { modelId: "gpt-5.2[reasoning=medium,fast=false]", name: "gpt-5.2" },
  { modelId: "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]", name: "claude-sonnet-4-6" },
  { modelId: "claude-sonnet-4-5[thinking=true,context=200k]", name: "claude-sonnet-4-5" },
  { modelId: "gemini-3.7-flash[effort=high]", name: "gemini-3.7-flash" },
  { modelId: "kimi-k3[reasoning=max]", name: "kimi-k3" },
  { modelId: "gpt-5.5[context=272k,reasoning=medium,fast=false]", name: "gpt-5.5" },
];

test("list-models aliases map to ACP presets only when they mean the same configuration", () => {
  // Exactly the preset's configuration.
  assert.equal(mapCursorModel("cursor-grok-4.6-high-fast", PRESETS), "grok-4.6[effort=high,fast=true]");
  assert.equal(mapCursorModel("composer-2.5-fast", PRESETS), "composer-2.5[fast=true]");
  assert.equal(mapCursorModel("claude-opus-5-thinking-high", PRESETS), "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]");
  assert.equal(mapCursorModel("claude-4.6-sonnet-medium-thinking", PRESETS), "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]");
  assert.equal(mapCursorModel("gemini-3.7-flash-high", PRESETS), "gemini-3.7-flash[effort=high]");
  assert.equal(mapCursorModel("kimi-k3-max", PRESETS), "kimi-k3[reasoning=max]");
  // No level in the alias means the model's default level.
  assert.equal(mapCursorModel("gpt-5.2", PRESETS), "gpt-5.2[reasoning=medium,fast=false]");
  assert.equal(mapCursorModel("auto", PRESETS), "default[]");
  // Already a preset id (typed by hand).
  assert.equal(mapCursorModel("gpt-5.2[reasoning=medium,fast=false]", PRESETS), "gpt-5.2[reasoning=medium,fast=false]");
  // A different configuration than the preset: not mapped, so the caller keeps `--model`.
  assert.equal(mapCursorModel("composer-2.5", PRESETS), undefined);
  assert.equal(mapCursorModel("cursor-grok-4.6-high", PRESETS), undefined);
  assert.equal(mapCursorModel("gpt-5.3-codex-high-fast", PRESETS), undefined);
  assert.equal(mapCursorModel("gpt-5.5-extra-high-fast", PRESETS), undefined);
  assert.equal(mapCursorModel("claude-4.5-sonnet", PRESETS), undefined);
  assert.equal(mapCursorModel("claude-4.5-sonnet-thinking", PRESETS), "claude-sonnet-4-5[thinking=true,context=200k]");
  assert.equal(mapCursorModel("no-such-model", PRESETS), undefined);
  assert.equal(mapCursorModel("", PRESETS), undefined);
});
