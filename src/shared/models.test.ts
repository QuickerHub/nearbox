import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENTS_LISTING_MODELS,
  BUILTIN_MODELS,
  MODELS_STALE_MS,
  canListModels,
  filterModels,
  modelLabel,
  modelsForAgent,
  modelsNeedRefresh,
  normalizeModelId,
} from "./models.ts";

test("canListModels matches the CLI catalog agents", () => {
  for (const kind of AGENTS_LISTING_MODELS) {
    assert.equal(canListModels(kind), true);
  }
  assert.equal(canListModels("claude"), false);
  assert.equal(BUILTIN_MODELS.cursor[0]?.id, "auto");
  assert.ok(BUILTIN_MODELS.claude.length >= 3);
  assert.deepEqual(BUILTIN_MODELS.opencode, []);
});

test("modelsNeedRefresh skips unavailable and non-listing agents", () => {
  assert.equal(
    modelsNeedRefresh({ kind: "claude", available: true, models: [], modelsCheckedAt: undefined }),
    false,
  );
  assert.equal(
    modelsNeedRefresh({ kind: "cursor", available: false, models: [{ id: "auto", label: "Auto" }] }),
    false,
  );
});

test("modelsNeedRefresh wants a fetch when empty, errored, or stale", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  assert.equal(
    modelsNeedRefresh({ kind: "cursor", available: true, models: [], modelsCheckedAt: undefined }, now),
    true,
  );
  assert.equal(
    modelsNeedRefresh(
      {
        kind: "cursor",
        available: true,
        models: [{ id: "auto", label: "Auto" }],
        modelsError: "timeout",
        modelsCheckedAt: new Date(now).toISOString(),
      },
      now,
    ),
    true,
  );
  assert.equal(
    modelsNeedRefresh(
      {
        kind: "grok",
        available: true,
        models: [{ id: "grok-4.6", label: "Grok 4.6" }],
        modelsCheckedAt: new Date(now - MODELS_STALE_MS - 1).toISOString(),
      },
      now,
    ),
    true,
  );
  assert.equal(
    modelsNeedRefresh(
      {
        kind: "grok",
        available: true,
        models: [{ id: "grok-4.6", label: "Grok 4.6" }],
        modelsCheckedAt: new Date(now - 1_000).toISOString(),
      },
      now,
    ),
    false,
  );
  assert.equal(
    modelsNeedRefresh(
      {
        kind: "codex",
        available: true,
        models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
        modelsCheckedAt: "not-a-date",
      },
      now,
    ),
    true,
  );
});

test("modelsForAgent prefers the live catalog over builtins", () => {
  const live = [{ id: "composer-2.5", label: "Composer 2.5" }];
  assert.equal(modelsForAgent("cursor", { models: live }), live);
  assert.equal(modelsForAgent("cursor", { models: [] }), BUILTIN_MODELS.cursor);
  assert.equal(modelsForAgent("cursor", undefined), BUILTIN_MODELS.cursor);
  assert.equal(modelsForAgent("opencode", undefined), BUILTIN_MODELS.opencode);
});

test("modelLabel falls back to the id when the catalog has no match", () => {
  const models = [
    { id: "auto", label: "Auto" },
    { id: "composer-2.5", label: "Composer 2.5" },
  ];
  assert.equal(modelLabel(models, "composer-2.5"), "Composer 2.5");
  assert.equal(modelLabel(models, "mystery"), "mystery");
  assert.equal(modelLabel([{ id: "x" }], "x"), "x");
});

test("filterModels matches every query word against id and label", () => {
  const models = [
    { id: "gpt-5.5-high", label: "GPT-5.5 High" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "auto", label: "Auto" },
  ];
  assert.deepEqual(
    filterModels(models, "  ").map((m) => m.id),
    ["gpt-5.5-high", "claude-opus-5", "auto"],
  );
  assert.deepEqual(
    filterModels(models, "opus 5").map((m) => m.id),
    ["claude-opus-5"],
  );
  assert.deepEqual(
    filterModels(models, "GPT high").map((m) => m.id),
    ["gpt-5.5-high"],
  );
  assert.deepEqual(filterModels(models, "nope"), []);
});

test("normalizeModelId rejects blank, huge, and control characters", () => {
  assert.equal(normalizeModelId("  composer-2.5  "), "composer-2.5");
  assert.equal(normalizeModelId(""), undefined);
  assert.equal(normalizeModelId("   "), undefined);
  assert.equal(normalizeModelId(null), undefined);
  assert.equal(normalizeModelId(undefined), undefined);
  assert.equal(normalizeModelId("a\nb"), undefined);
  assert.equal(normalizeModelId("a\u0000b"), undefined);
  assert.equal(normalizeModelId("x".repeat(201)), undefined);
  assert.equal(normalizeModelId("x".repeat(200)), "x".repeat(200));
});
