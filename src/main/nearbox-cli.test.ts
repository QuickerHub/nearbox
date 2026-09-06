import assert from "node:assert/strict";
import test from "node:test";
// The command itself is plain JavaScript shipped in resources/; these tests pin its argument handling.
import { agentKindOf, DEFAULT_WAIT_SECONDS, formatDuration, MAX_WAIT_SECONDS, parseArgs, readContext } from "../../resources/cli/nearbox.mjs";

test("agent names are forgiving about case, dashes and long forms", () => {
  assert.equal(agentKindOf("grok"), "grok");
  assert.equal(agentKindOf("Claude-Code"), "claude");
  assert.equal(agentKindOf("cursor-agent"), "cursor");
  assert.equal(agentKindOf("Grok Build"), "grok");
  assert.equal(agentKindOf("gpt"), undefined);
});

test("ask: agent, options and the prompt words", () => {
  const parsed = parseArgs(["ask", "grok", "--project", "nearbox", "--full", "--continue", "补上", "单元测试"]);
  assert.deepEqual(parsed, {
    command: "ask",
    agent: "grok",
    prompt: "补上 单元测试",
    file: undefined,
    project: "nearbox",
    model: undefined,
    access: "full",
    continue: true,
    wait: DEFAULT_WAIT_SECONDS,
  });
});

test("ask: options may follow the prompt, unknown dashes inside the prompt are words", () => {
  const parsed = parseArgs(["ask", "claude", "跑", "--verbose", "看看", "--no-wait", "--model=sonnet"]);
  assert.equal(parsed.command, "ask");
  if (parsed.command === "ask") {
    assert.equal(parsed.prompt, "跑 --verbose 看看");
    assert.equal(parsed.wait, 0);
    assert.equal(parsed.model, "sonnet");
  }
});

test("ask: --file and stdin, wait is clamped", () => {
  const parsed = parseArgs(["ask", "codex", "--file", "-", "--wait", "900"]);
  assert.equal(parsed.command, "ask");
  if (parsed.command === "ask") {
    assert.equal(parsed.file, "-");
    assert.equal(parsed.prompt, "");
    assert.equal(parsed.wait, MAX_WAIT_SECONDS);
  }
});

test("ask: mistakes are reported instead of guessed", () => {
  assert.equal(parseArgs(["ask"]).command, "error");
  assert.equal(parseArgs(["ask", "gpt", "x"]).command, "error");
  assert.equal(parseArgs(["ask", "grok", "--full", "--safe", "x"]).command, "error");
  assert.equal(parseArgs(["ask", "grok", "--bogus", "x"]).command, "error");
  assert.equal(parseArgs(["ask", "grok", "--project"]).command, "error");
  assert.equal(parseArgs(["frobnicate"]).command, "error");
});

test("wait and status", () => {
  assert.deepEqual(parseArgs(["wait"]), { command: "wait", runId: undefined, wait: DEFAULT_WAIT_SECONDS });
  assert.deepEqual(parseArgs(["wait", "3f2a1b7c", "--wait", "30"]), { command: "wait", runId: "3f2a1b7c", wait: 30 });
  assert.equal(parseArgs(["wait", "a", "b"]).command, "error");
  assert.deepEqual(parseArgs(["status"]), { command: "status" });
  assert.deepEqual(parseArgs([]), { command: "help" });
  assert.deepEqual(parseArgs(["ask", "--help"]), { command: "help" });
});

test("the run context comes from the environment Nearbox sets, or is absent", () => {
  assert.deepEqual(readContext({ NEARBOX_URL: "http://127.0.0.1:17831/", NEARBOX_TOKEN: "t", NEARBOX_RUN_ID: "r" }), {
    url: "http://127.0.0.1:17831",
    token: "t",
    runId: "r",
  });
  assert.equal(readContext({ NEARBOX_URL: "http://127.0.0.1:17831" }), null);
});

test("durations read like the app shows them", () => {
  assert.equal(formatDuration("2026-09-07T00:00:00.000Z", "2026-09-07T00:00:42.000Z"), "42s");
  assert.equal(formatDuration("2026-09-07T00:00:00.000Z", "2026-09-07T00:02:05.000Z"), "2m05s");
  assert.equal(formatDuration(undefined, undefined), "");
});
