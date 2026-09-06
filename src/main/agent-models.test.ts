import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_LIST_ARGS, parseModelList } from "./agent-models.ts";
import { filterModels, modelLabel, MODELS_STALE_MS, modelsForAgent, modelsNeedRefresh, normalizeModelId } from "../shared/models.ts";

test("cursor-agent --list-models: id, label and the default marker", () => {
  const stdout = [
    "Available models",
    "",
    "auto - Auto (default)",
    "gpt-5.5-high - GPT-5.5 1M High",
    "claude-opus-5-thinking-high-fast - Claude Opus 5 1M Thinking Fast",
    "composer-2.5 - Composer 2.5 (current)",
    "claude-fable-5-1-max - Claude Fable 5.1 1M Max (NO ZDR)",
    "",
    "Tip: use --model <id> (or /model <id> in interactive mode) to switch. Parameterized models also accept quoted overrides, e.g. --model 'claude-opus-4-8[context=1m,effort=high,fast=false]'.",
  ].join("\n");
  const models = parseModelList("cursor", stdout);
  assert.deepEqual(models, [
    { id: "auto", label: "Auto", isDefault: true },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "claude-opus-5-thinking-high-fast", label: "Claude Opus 5 1M Thinking Fast" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "claude-fable-5-1-max", label: "Claude Fable 5.1 1M Max (NO ZDR)" },
  ]);
});

test("codex debug models: visible slugs only, in catalog order", () => {
  const stdout = JSON.stringify({
    models: [
      { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide" },
      { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", base_instructions: "You are Codex…" },
      { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
      { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide" },
      { slug: "", display_name: "broken" },
    ],
  });
  assert.deepEqual(parseModelList("codex", `some log line\n${stdout}`), [
    { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
    { id: "gpt-5.5", label: "GPT-5.5" },
  ]);
  assert.deepEqual(parseModelList("codex", "not json"), []);
});

test("grok models: bullets with the default flagged", () => {
  const stdout = ["You are logged in with grok.com.", "", "Default model: grok-4.6", "", "Available models:", "  * grok-4.6 (default)", "  - grok-4.5"].join("\n");
  assert.deepEqual(parseModelList("grok", stdout), [{ id: "grok-4.6", isDefault: true }, { id: "grok-4.5" }]);
});

test("opencode models: provider/model lines, log noise ignored", () => {
  const stdout = ["INFO  2026-09-07 service=models loading", "opencode/big-pickle", "anthropic/claude-sonnet-5", "openai/gpt-5.5", "", "done"].join("\r\n");
  assert.deepEqual(parseModelList("opencode", stdout), [{ id: "opencode/big-pickle" }, { id: "anthropic/claude-sonnet-5" }, { id: "openai/gpt-5.5" }]);
});

test("claude has no catalog command and parses to nothing", () => {
  assert.equal(MODEL_LIST_ARGS.claude, undefined);
  assert.deepEqual(parseModelList("claude", "anything"), []);
});

test("duplicates and ANSI colour codes are dropped", () => {
  const stdout = "\u001b[1mAvailable models\u001b[0m\n\u001b[32mauto\u001b[0m - Auto\nauto - Auto again\n";
  assert.deepEqual(parseModelList("cursor", stdout), [{ id: "auto", label: "Auto" }]);
});

test("the picker falls back to the built-in catalog and labels ids it knows", () => {
  const fetched = [{ id: "gpt-5.5-high", label: "GPT-5.5 High" }];
  assert.deepEqual(modelsForAgent("cursor", { models: fetched }), fetched);
  assert.equal(modelsForAgent("cursor", { models: [] })[0]?.id, "auto");
  assert.equal(modelsForAgent("claude", undefined).some((model) => model.id === "sonnet"), true);
  assert.equal(modelLabel(fetched, "gpt-5.5-high"), "GPT-5.5 High");
  assert.equal(modelLabel(fetched, "mystery"), "mystery");
});

test("filtering matches every word against id and label", () => {
  const models = [
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "claude-opus-5-high", label: "Claude Opus 5 1M" },
    { id: "auto", label: "Auto" },
  ];
  assert.deepEqual(
    filterModels(models, "opus high").map((model) => model.id),
    ["claude-opus-5-high"],
  );
  assert.equal(filterModels(models, "  ").length, 3);
  assert.equal(filterModels(models, "GPT").length, 1);
});

test("a catalog is re-fetched when missing, failed, or older than the staleness window", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const fresh = new Date(now - 5 * 60_000).toISOString();
  const old = new Date(now - MODELS_STALE_MS - 1).toISOString();
  const models = [{ id: "auto" }];
  const base = { kind: "cursor" as const, available: true };
  assert.equal(modelsNeedRefresh({ ...base, models, modelsCheckedAt: fresh }, now), false);
  assert.equal(modelsNeedRefresh({ ...base, models, modelsCheckedAt: old }, now), true);
  assert.equal(modelsNeedRefresh({ ...base, models: undefined }, now), true);
  assert.equal(modelsNeedRefresh({ ...base, models, modelsCheckedAt: fresh, modelsError: "offline" }, now), true);
  // Nothing to fetch for CLIs that cannot list, or ones that are not installed.
  assert.equal(modelsNeedRefresh({ kind: "claude", available: true, models: undefined }, now), false);
  assert.equal(modelsNeedRefresh({ ...base, available: false, models: undefined }, now), false);
});

test("model ids are trimmed and must fit on a command line", () => {
  assert.equal(normalizeModelId("  gpt-5.5 "), "gpt-5.5");
  assert.equal(normalizeModelId(""), undefined);
  assert.equal(normalizeModelId("bad\nid"), undefined);
  assert.equal(normalizeModelId(undefined), undefined);
});
