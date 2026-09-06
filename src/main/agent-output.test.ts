import assert from "node:assert/strict";
import test from "node:test";
import { buildInvocation, createOutputParser, type ParsedEvent, quoteForCmd, toolKindOf, versionKey } from "./agent-output.ts";

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

test("codex gets each image as its own -i, before the flags and the stdin marker", () => {
  const images = ["D:\\inbox\\a.png", "D:\\inbox\\b.jpg"];
  const fresh = buildInvocation("codex", direct(), { ...request, images }).args;
  assert.deepEqual(fresh.slice(0, 5), ["exec", "-i", images[0], "-i", images[1]]);
  assert.equal(fresh.at(-1), "-");
  const resumed = buildInvocation("codex", direct(), { ...request, images, resumeSessionId: "sess-9" }).args;
  assert.deepEqual(resumed.slice(0, 7), ["exec", "resume", "sess-9", "-i", images[0], "-i", images[1]]);
  // Other CLIs take the paths from the prompt text instead.
  assert.ok(!buildInvocation("claude", direct(), { ...request, images }).args.includes("-i"));
  assert.ok(!buildInvocation("cursor", direct(), { ...request, images }).args.includes(images[0]!));
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
    '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"npm test","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"npm test","aggregated_output":"ok","exit_code":0,"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{"input_tokens":15085,"output_tokens":6}}',
  ]);
  assert.equal(all.sessionId, "01a07672-18fc-7cd0-94c1-d1b5571276f4");
  assert.equal(all.result, "PONG");
  assert.equal(all.isError, undefined);
  assert.deepEqual(
    all.events.map((event) => event.kind),
    ["tool", "tool", "text", "result"],
  );
  assert.equal(all.events[0]?.text, "$ npm test");
  assert.equal(all.events[0]?.tool?.status, "running");
  assert.equal(all.events[1]?.tool?.id, "item_1");
  assert.equal(all.events[1]?.tool?.status, "ok");
  assert.equal(all.events[1]?.tool?.exitCode, 0);
  assert.equal(all.events[1]?.tool?.output, "ok");
});

test("codex file changes and pwsh-wrapped failures become structured tools", () => {
  const parser = createOutputParser("codex");
  const all = feedAll(parser, [
    '{"type":"item.started","item":{"id":"item_2","type":"file_change","changes":[{"path":"C:\\\\tmp\\\\hello.txt","kind":"add"}],"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"C:\\\\tmp\\\\hello.txt","kind":"add"}],"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"item_4","type":"command_execution","command":"\\"C:\\\\\\\\Program Files\\\\\\\\PowerShell\\\\\\\\7\\\\\\\\pwsh.exe\\" -Command \'exit 3\'","aggregated_output":"","exit_code":3,"status":"failed"}}',
  ]);
  const tools = all.events.map((event) => event.tool).filter(Boolean);
  assert.equal(tools.length, 3);
  assert.equal(tools[1]?.kind, "write");
  assert.equal(tools[1]?.subject, "hello.txt");
  assert.deepEqual(tools[1]?.files, ["C:\\tmp\\hello.txt"]);
  assert.equal(tools[2]?.kind, "shell");
  assert.equal(tools[2]?.command, "exit 3");
  assert.equal(tools[2]?.status, "error");
  assert.equal(tools[2]?.exitCode, 3);
});

test("cursor-agent stream-json coalesces thinking deltas and surfaces the result", () => {
  const parser = createOutputParser("cursor");
  const all = feedAll(parser, [
    '{"type":"system","subtype":"init","cwd":"C:\\\\tmp","session_id":"944aefbb","model":"Cursor Grok 4.6 High Fast","permissionMode":"default"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply PONG"}]},"session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"delta","text":"The user requested the","session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"delta","text":" exact word PONG","session_id":"944aefbb"}',
    '{"type":"thinking","subtype":"completed","session_id":"944aefbb"}',
    '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"D:\\\\x\\\\a.ts"}}},"session_id":"944aefbb"}',
    '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"D:\\\\x\\\\a.ts"},"result":{"success":{"content":"x"}}}},"session_id":"944aefbb"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me check."}]},"session_id":"944aefbb"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"PONG"}]},"session_id":"944aefbb"}',
    '{"type":"result","subtype":"success","duration_ms":4835,"is_error":false,"result":"Let me check.PONG","session_id":"944aefbb"}',
  ]);
  assert.equal(all.sessionId, "944aefbb");
  assert.equal(all.modelLabel, "Cursor Grok 4.6 High Fast");
  // The glued-together `result` field is ignored in favour of the last assistant message.
  assert.equal(all.result, "PONG");
  assert.equal(all.isError, false);
  const thinking = all.events.filter((event) => event.kind === "thinking");
  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.text, "The user requested the exact word PONG");
  const tools = all.events.filter((event) => event.kind === "tool");
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.text, "读取 a.ts");
  assert.equal(tools[0]?.tool?.kind, "read");
  assert.equal(tools[0]?.tool?.status, "running");
  assert.equal(tools[1]?.tool?.id, "c1");
  assert.equal(tools[1]?.tool?.status, "ok");
  assert.equal(tools[1]?.tool?.output, "x");
  assert.ok(!all.events.some((event) => event.kind === "status"));
  assert.equal(all.events.at(-1)?.kind, "result");
});

test("cursor-agent shell, edit and rejected calls carry command, diff and reason", () => {
  const parser = createOutputParser("cursor");
  const shellArgs = '{"command":"echo hello","workingDirectory":"","timeout":30000,"toolCallId":"s1","description":"Print hello"}';
  const all = feedAll(parser, [
    `{"type":"tool_call","subtype":"started","call_id":"s1","tool_call":{"shellToolCall":{"args":${shellArgs},"description":"Print hello"}}}`,
    '{"type":"tool_call","subtype":"started","call_id":"e1","tool_call":{"editToolCall":{"args":{"path":"C:\\\\tmp\\\\hello.txt","streamContent":"hi\\n"}}}}',
    '{"type":"tool_call","subtype":"completed","call_id":"e1","tool_call":{"editToolCall":{"args":{"path":"C:\\\\tmp\\\\hello.txt","streamContent":"hi\\n"},"result":{"success":{"path":"C:\\\\tmp\\\\hello.txt","linesAdded":1,"linesRemoved":0,"diffString":"--- /dev/null\\n+++ b/hello.txt\\n@@ -1,0 +1 @@\\n+hi","message":"Wrote"}}}}}',
    `{"type":"tool_call","subtype":"completed","call_id":"s1","tool_call":{"shellToolCall":{"args":${shellArgs},"result":{"success":{"command":"echo hello","exitCode":0,"stdout":"hello\\r\\n","stderr":"","interleavedOutput":"hello\\r\\n"}}}}}`,
    '{"type":"tool_call","subtype":"started","call_id":"s2","tool_call":{"shellToolCall":{"args":{"command":"npm run dev","workingDirectory":"D:\\\\Work"}}}}',
    '{"type":"tool_call","subtype":"completed","call_id":"s2","tool_call":{"shellToolCall":{"args":{"command":"npm run dev"},"result":{"rejected":{"command":"npm run dev","reason":"","isReadonly":false}}}}}',
    '{"type":"tool_call","subtype":"completed","call_id":"g1","tool_call":{"globToolCall":{"args":{"targetDirectory":"D:\\\\Work","globPattern":"*.txt"},"result":{"error":{"error":"Path does not exist: D:\\\\Work"}}}}}',
  ]);
  const byId = new Map<string, NonNullable<(typeof all.events)[number]["tool"]>[]>();
  for (const event of all.events) {
    if (event.tool) {
      byId.set(event.tool.id, [...(byId.get(event.tool.id) ?? []), event.tool]);
    }
  }
  const shell = byId.get("s1")!;
  assert.equal(shell[0]?.status, "running");
  assert.equal(shell[0]?.command, "echo hello");
  assert.equal(shell[0]?.description, "Print hello");
  assert.equal(shell[1]?.status, "ok");
  assert.equal(shell[1]?.exitCode, 0);
  assert.equal(shell[1]?.output, "hello\n");
  const edit = byId.get("e1")!;
  assert.equal(edit[1]?.kind, "edit");
  assert.equal(edit[1]?.subject, "hello.txt");
  assert.equal(edit[1]?.linesAdded, 1);
  assert.ok(edit[1]?.diff?.includes("+hi"));
  const rejected = byId.get("s2")!;
  assert.equal(rejected[1]?.status, "rejected");
  assert.ok(rejected[1]?.error?.includes("安全模式"));
  const glob = byId.get("g1")!;
  assert.equal(glob[0]?.status, "error");
  assert.equal(glob[0]?.subject, "*.txt");
  assert.ok(glob[0]?.error?.includes("Path does not exist"));
});

test("claude tool_use / tool_result pairs share an id", () => {
  const parser = createOutputParser("claude");
  const all = feedAll(parser, [
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"npm test","description":"Run tests"}}]},"session_id":"cf9a"}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"1 passing","is_error":false}]},"session_id":"cf9a"}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"/repo/src/a.ts"}}]},"session_id":"cf9a"}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_2","content":[{"type":"text","text":"File not found"}],"is_error":true}]},"session_id":"cf9a"}',
  ]);
  const tools = all.events.map((event) => event.tool).filter(Boolean);
  assert.equal(tools.length, 4);
  assert.equal(tools[0]?.kind, "shell");
  assert.equal(tools[0]?.command, "npm test");
  assert.equal(tools[1]?.id, "toolu_1");
  assert.equal(tools[1]?.status, "ok");
  assert.equal(tools[1]?.output, "1 passing");
  assert.equal(tools[2]?.kind, "read");
  assert.equal(tools[2]?.subject, "a.ts");
  assert.equal(tools[3]?.status, "error");
  assert.equal(tools[3]?.error, "File not found");
});

test("tool kinds are recognised across CLI naming styles", () => {
  assert.equal(toolKindOf("shellToolCall"), "shell");
  assert.equal(toolKindOf("Bash"), "shell");
  assert.equal(toolKindOf("command_execution"), "shell");
  assert.equal(toolKindOf("readToolCall"), "read");
  assert.equal(toolKindOf("Read"), "read");
  assert.equal(toolKindOf("editToolCall"), "edit");
  assert.equal(toolKindOf("MultiEdit"), "edit");
  assert.equal(toolKindOf("Write"), "write");
  assert.equal(toolKindOf("globToolCall"), "glob");
  assert.equal(toolKindOf("Grep"), "grep");
  assert.equal(toolKindOf("codebase_search"), "grep");
  assert.equal(toolKindOf("WebSearch"), "web");
  assert.equal(toolKindOf("taskToolCall"), "task");
  assert.equal(toolKindOf("TodoWrite"), "todo");
  assert.equal(toolKindOf("mcp_tool_call"), "mcp");
  assert.equal(toolKindOf("somethingElse"), "other");
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

test("grok ACP tool calls and updates merge by toolCallId", () => {
  const parser = createOutputParser("grok");
  const all = feedAll(parser, [
    '{"type":"tool_call","toolCallId":"t1","title":"npm test","kind":"execute","status":"pending","rawInput":{"command":"npm test"}}',
    '{"type":"tool_call_update","toolCallId":"t1"}',
    '{"type":"tool_call_update","toolCallId":"t1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"1 passing"}}]}',
    '{"type":"tool_call","toolCallId":"t2","title":"Edit src/a.ts","kind":"edit","status":"completed","content":[{"type":"diff","path":"src/a.ts","oldText":"a","newText":"b"}]}',
  ]);
  const tools = all.events.map((event) => event.tool).filter(Boolean);
  // The empty progress tick is dropped.
  assert.equal(tools.length, 3);
  assert.equal(tools[0]?.kind, "shell");
  assert.equal(tools[0]?.command, "npm test");
  assert.equal(tools[1]?.status, "ok");
  assert.equal(tools[1]?.output, "1 passing");
  assert.equal(tools[2]?.kind, "edit");
  assert.equal(tools[2]?.subject, "a.ts");
  assert.equal(tools[2]?.diff, "-a\n+b");
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
  const events: ParsedEvent[] = [];
  let sessionId: string | undefined;
  let modelLabel: string | undefined;
  let result: string | undefined;
  let isError: boolean | undefined;
  for (const line of lines) {
    const parsed = parser.feed(line);
    events.push(...parsed.events);
    sessionId = parsed.sessionId ?? sessionId;
    modelLabel = parsed.modelLabel ?? modelLabel;
    result = parsed.result ?? result;
    isError = parsed.isError ?? isError;
  }
  const tail = parser.end();
  events.push(...tail.events);
  result = result ?? tail.result;
  return { events, sessionId, modelLabel, result, isError };
}
