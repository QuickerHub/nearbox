import assert from "node:assert/strict";
import test from "node:test";
import { buildInvocation, createOutputParser, quoteForCmd, versionKey } from "./agent-output.ts";

const request = {
  prompt: "修复登录页\n第二行 \"带引号\" 和 %PATH%",
  cwd: "D:\\code\\my app",
  access: "safe" as const,
  promptFile: "D:\\data\\runs\\abc.prompt.md",
};

test("cursor-agent gets the prompt as a real argv entry when spawned directly", () => {
  const inv = buildInvocation("cursor", { file: "node.exe", prefixArgs: ["index.js"], display: "", viaCmd: false }, request);
  assert.equal(inv.file, "node.exe");
  assert.deepEqual(inv.args.slice(0, 3), ["index.js", "-p", "--output-format"]);
  assert.equal(inv.args.at(-1), request.prompt);
  assert.ok(inv.args.includes("--workspace"));
  assert.ok(!inv.args.includes("--force"));
  assert.equal(inv.stdin, undefined);
});

test("full access adds the agent-specific yolo flag", () => {
  const full = { ...request, access: "full" as const };
  assert.ok(buildInvocation("cursor", direct(), full).args.includes("--force"));
  assert.ok(buildInvocation("codex", direct(), full).args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(buildInvocation("claude", direct(), full).args.includes("--dangerously-skip-permissions"));
  const grok = buildInvocation("grok", direct(), full).args;
  assert.equal(grok[grok.indexOf("--permission-mode") + 1], "bypassPermissions");
});

test("codex and claude receive the prompt over stdin, grok via file", () => {
  const codex = buildInvocation("codex", direct(), request);
  assert.equal(codex.stdin, request.prompt);
  assert.equal(codex.args.at(-1), "-");
  assert.ok(codex.args.includes("workspace-write"));
  const claude = buildInvocation("claude", direct(), request);
  assert.equal(claude.stdin, request.prompt);
  const grok = buildInvocation("grok", direct(), request);
  assert.equal(grok.args[grok.args.indexOf("--prompt-file") + 1], request.promptFile);
  assert.equal(grok.stdin, undefined);
});

test("resume reuses the previous session id", () => {
  const resumed = { ...request, resumeSessionId: "sess-123" };
  const codex = buildInvocation("codex", direct(), resumed).args;
  assert.deepEqual(codex.slice(0, 3), ["exec", "resume", "sess-123"]);
  assert.ok(!codex.includes("-C"));
  assert.ok(buildInvocation("cursor", direct(), resumed).args.includes("--resume"));
  assert.ok(buildInvocation("claude", direct(), resumed).args.includes("-r"));
});

test("cmd.exe fallback never puts the prompt on the command line", () => {
  const inv = buildInvocation("cursor", { file: "cmd.exe", prefixArgs: ["C:\\bin\\cursor-agent.cmd"], display: "", viaCmd: true }, request);
  assert.equal(inv.windowsVerbatimArguments, true);
  const line = inv.args.at(-1) ?? "";
  assert.ok(line.startsWith('"C:\\bin\\cursor-agent.cmd '));
  assert.ok(!line.includes("带引号"));
  assert.ok(line.includes(request.promptFile));
  assert.ok(line.includes('"D:\\code\\my app"'));
});

test("quoteForCmd only quotes when needed and escapes inner quotes", () => {
  assert.equal(quoteForCmd("plain"), "plain");
  assert.equal(quoteForCmd("has space"), '"has space"');
  assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForCmd(""), '""');
});

test("cursor-agent version folders sort newest first", () => {
  const names = ["2026.08.31-4057e58", "2026.09.02-c22c1a3", "2026.09.02-10-00-00-abc"];
  const sorted = [...names].sort((a, b) => versionKey(b) - versionKey(a));
  assert.equal(sorted[0], "2026.09.02-10-00-00-abc");
  assert.equal(sorted.at(-1), "2026.08.31-4057e58");
});

test("codex exec --json is mapped to events, session and result", () => {
  const parser = createOutputParser("codex");
  const all = feedAll(parser, [
    '{"type":"thread.started","thread_id":"01a07672-18fc-7cd0-94c1-d1b5571276f4"}',
    '{"type":"turn.started"}',
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"npm test"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"npm test","aggregated_output":"ok","exit_code":0}}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{"input_tokens":15085,"output_tokens":6}}',
  ]);
  assert.equal(all.sessionId, "01a07672-18fc-7cd0-94c1-d1b5571276f4");
  assert.equal(all.result, "PONG");
  assert.equal(all.isError, undefined);
  assert.deepEqual(
    all.events.map((event) => event.kind),
    ["status", "status", "tool", "tool", "text", "result"],
  );
  assert.equal(all.events[2]?.text, "$ npm test");
});

test("cursor-agent stream-json coalesces thinking deltas and surfaces the result", () => {
  const parser = createOutputParser("cursor");
  const all = feedAll(parser, [
    '{"type":"system","subtype":"init","cwd":"C:\\\\tmp","session_id":"944aefbb","model":"Cursor Grok 4.6 High Fast","permissionMode":"default"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply PONG"}]},"session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"delta","text":"The user requested the","session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"delta","text":" exact word PONG","session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"completed","session_id":"944aefbb"}',
    '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"a.ts"}}},"session_id":"944aefbb"}',
    '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"a.ts"},"result":{"success":{"content":"x"}}}},"session_id":"944aefbb"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"PONG"}]},"session_id":"944aefbb"}',
    '{"type":"result","subtype":"success","duration_ms":4835,"is_error":false,"result":"PONG","session_id":"944aefbb"}',
  ]);
  assert.equal(all.sessionId, "944aefbb");
  assert.equal(all.result, "PONG");
  assert.equal(all.isError, false);
  const thinking = all.events.filter((event) => event.kind === "thinking");
  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.text, "The user requested the exact word PONG");
  assert.ok(all.events.some((event) => event.kind === "tool" && event.text.startsWith("read ")));
  assert.equal(all.events.at(-1)?.kind, "result");
});

test("claude login failure is reported as an error result", () => {
  const parser = createOutputParser("claude");
  const all = feedAll(parser, [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Invalid API key · Please run /login"}]},"session_id":"cf9a"}',
    '{"type":"result","subtype":"success","is_error":true,"duration_ms":3224,"result":"Invalid API key · Please run /login","session_id":"cf9a"}',
  ]);
  assert.equal(all.isError, true);
  assert.equal(all.result, "Invalid API key · Please run /login");
});

test("grok streaming-json merges text deltas and ends cleanly", () => {
  const parser = createOutputParser("grok");
  const all = feedAll(parser, [
    '{"type":"available_commands","tools":["read_file"],"commands":["compact"]}',
    '{"type":"thought","data":"The"}',
    '{"type":"thought","data":" user"}',
    '{"type":"text","data":"P"}',
    '{"type":"text","data":"ONG"}',
    '{"type":"usage","usage":{"input_tokens":16030}}',
    '{"type":"end","stopReason":"end_turn","sessionId":"01a07672-27b7","total_cost_usd":0.0055148}',
  ]);
  assert.equal(all.sessionId, "01a07672-27b7");
  assert.equal(all.isError, false);
  assert.deepEqual(
    all.events.map((event) => [event.kind, event.text]),
    [
      ["thinking", "The user"],
      ["text", "PONG"],
      ["result", "完成 · $0.0055"],
    ],
  );
  assert.equal(all.result, "PONG");
});

test("non-JSON lines are kept as raw output", () => {
  const parser = createOutputParser("codex");
  const all = feedAll(parser, ["warning: something odd", "{not json"]);
  assert.deepEqual(
    all.events.map((event) => event.kind),
    ["raw", "raw"],
  );
});

function direct() {
  return { file: "tool.exe", prefixArgs: [], display: "", viaCmd: false };
}

function feedAll(parser: ReturnType<typeof createOutputParser>, lines: string[]) {
  const events: { kind: string; text: string }[] = [];
  let sessionId: string | undefined;
  let result: string | undefined;
  let isError: boolean | undefined;
  for (const line of lines) {
    const parsed = parser.feed(line);
    events.push(...parsed.events);
    sessionId = parsed.sessionId ?? sessionId;
    result = parsed.result ?? result;
    isError = parsed.isError ?? isError;
  }
  const tail = parser.end();
  events.push(...tail.events);
  result = result ?? tail.result;
  return { events, sessionId, result, isError };
}
