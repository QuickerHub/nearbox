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
