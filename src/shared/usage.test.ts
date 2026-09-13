import assert from "node:assert/strict";
import test from "node:test";
import {
  contextUsed,
  contextWindowFromModelUsage,
  formatContextUsage,
  formatTokens,
  inferContextWindow,
  mergeUsage,
  parseUsage,
  sameUsage,
} from "./usage.ts";

test("parseUsage accepts snake_case, camelCase and nested usage objects", () => {
  assert.deepEqual(parseUsage({ input_tokens: 16030, output_tokens: 6 }), { inputTokens: 16030, outputTokens: 6 });
  assert.deepEqual(parseUsage({ usage: { inputTokens: 812, outputTokens: 45, cacheReadTokens: 4000 } }), {
    inputTokens: 812,
    outputTokens: 45,
    cacheReadTokens: 4000,
  });
  assert.deepEqual(
    parseUsage({
      usage: {
        input_tokens: 7210,
        cache_read_input_tokens: 41000,
        cache_creation_input_tokens: 12,
        output_tokens: 1893,
        total_tokens: 50115,
      },
    }),
    {
      inputTokens: 7210,
      outputTokens: 1893,
      cacheReadTokens: 41000,
      cacheWriteTokens: 12,
      totalTokens: 50115,
    },
  );
  assert.equal(parseUsage({ foo: 1 }), undefined);
});

test("contextUsed adds Claude/Cursor cache buckets and leaves Codex input alone", () => {
  assert.equal(contextUsed({ inputTokens: 15085, outputTokens: 6 }), 15085);
  assert.equal(contextUsed({ inputTokens: 7210, outputTokens: 1893, cacheReadTokens: 41000, cacheWriteTokens: 12 }), 48222);
  assert.equal(contextUsed({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }), 100);
});

test("formatContextUsage and formatTokens stay compact", () => {
  assert.equal(formatTokens(812), "812");
  assert.equal(formatTokens(16030), "16.0k");
  assert.equal(formatTokens(200_000), "200k");
  assert.equal(formatTokens(1_000_000), "1m");
  assert.equal(formatContextUsage({ inputTokens: 16030, outputTokens: 6, contextWindow: 200_000 }), "16.0k / 200k");
  assert.equal(formatContextUsage({ inputTokens: 16030, outputTokens: 6 }), "16.0k");
  assert.equal(formatContextUsage({ inputTokens: 0, outputTokens: 0 }), "");
});

test("inferContextWindow reads bracket params, size suffixes and family defaults", () => {
  assert.equal(inferContextWindow("claude-opus-5[thinking=true,context=300k,effort=high]"), 300_000);
  assert.equal(inferContextWindow("Cursor Grok 4.6 High Fast"), 256_000);
  assert.equal(inferContextWindow("gpt-5.5-high"), 272_000);
  assert.equal(inferContextWindow("mystery-model"), undefined);
});

test("Grok modelUsage carries the real window on the current model row", () => {
  assert.equal(
    contextWindowFromModelUsage({
      "grok-4.6": { inputTokens: 7210, contextWindow: 256000 },
      "other": { inputTokens: 10 },
    }),
    256_000,
  );
});

test("mergeUsage keeps the richer of two reports", () => {
  const merged = mergeUsage({ inputTokens: 16030, outputTokens: 0, contextWindow: 200_000 }, { inputTokens: 16100, outputTokens: 40, costUsd: 0.01 });
  assert.equal(merged.inputTokens, 16100);
  assert.equal(merged.outputTokens, 40);
  assert.equal(merged.contextWindow, 200_000);
  assert.equal(merged.costUsd, 0.01);
});

test("sameUsage compares fields without JSON.stringify", () => {
  assert.equal(sameUsage(undefined, undefined), true);
  assert.equal(sameUsage(undefined, { inputTokens: 1, outputTokens: 0 }), false);
  const a = { inputTokens: 100, outputTokens: 5, cacheReadTokens: 10, contextWindow: 200_000 };
  assert.equal(sameUsage(a, { ...a }), true);
  assert.equal(sameUsage(a, { inputTokens: 100, outputTokens: 5, contextWindow: 200_000, cacheReadTokens: 10 }), true);
  assert.equal(sameUsage(a, { ...a, outputTokens: 6 }), false);
  assert.equal(sameUsage(a, mergeUsage(a, { inputTokens: 100, outputTokens: 5 })), true);
});

test("parseUsage reads _meta / tokenUsage wrappers and stringly numbers", () => {
  assert.deepEqual(
    parseUsage({ _meta: { usage: { prompt_tokens: "12", completion_tokens: "3", reasoning_tokens: "7" } } }),
    { inputTokens: 12, outputTokens: 3, reasoningTokens: 7 },
  );
  assert.deepEqual(parseUsage({ tokenUsage: { inputTokens: 9, outputTokens: 1 } }), { inputTokens: 9, outputTokens: 1 });
  assert.equal(parseUsage({ _meta: { usage: { inputTokens: 0, outputTokens: 0 } } }), undefined);
});

test("mergeUsage with no previous returns next; contextUsed prefers totalTokens when richer", () => {
  const next = { inputTokens: 50, outputTokens: 10, totalTokens: 80 };
  assert.equal(mergeUsage(undefined, next), next);
  assert.equal(contextUsed(next), 70);
});

test("inferContextWindow covers more families and sized suffixes", () => {
  assert.equal(inferContextWindow("claude-sonnet-4-6"), 200_000);
  assert.equal(inferContextWindow("claude-haiku-4"), 200_000);
  assert.equal(inferContextWindow("composer-2.5-fast"), 200_000);
  assert.equal(inferContextWindow("gpt-5-codex"), 256_000);
  assert.equal(inferContextWindow("window=1m"), 1_000_000);
  assert.equal(inferContextWindow("ctx: 128k"), 128_000);
});

test("contextWindowFromModelUsage ignores non-records and empty windows", () => {
  assert.equal(contextWindowFromModelUsage(null), undefined);
  assert.equal(contextWindowFromModelUsage({ a: 1 }), undefined);
  assert.equal(contextWindowFromModelUsage({ a: { contextWindow: 0 }, b: { context_window: 100_000 } }), 100_000);
});

