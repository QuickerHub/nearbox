import { isRecord } from "./tools.ts";

/** Token counts one CLI turn reported. Field names are ours; parsers map each dialect onto this. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Extra prompt tokens served from cache (Claude / Cursor / Grok). */
  cacheReadTokens?: number;
  /** Extra prompt tokens written into the cache. */
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  /** Context window size when the CLI or the model id tells us. */
  contextWindow?: number;
  costUsd?: number;
}

/**
 * How much of the context window this turn occupied. Cache-read / cache-write
 * tokens sit in the prompt on Claude, Cursor and Grok; Codex reports cache as
 * a subset of `inputTokens`, so those fields stay off this sum.
 */
export function contextUsed(usage: Pick<TokenUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens">): number {
  const extra = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (extra > 0) {
    return usage.inputTokens + extra;
  }
  if (usage.totalTokens && usage.totalTokens > usage.inputTokens) {
    return Math.max(0, usage.totalTokens - usage.outputTokens);
  }
  return usage.inputTokens;
}

/** "16.0k", "200k", "1.2m" — compact enough for a chip or a fold label. */
export function formatTokens(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    const k = n / 1000;
    return Number.isInteger(k) || k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return Number.isInteger(m) || m >= 10 ? `${Math.round(m)}m` : `${m.toFixed(1)}m`;
}

/** "16.0k / 200k" when the window is known, otherwise just the used count. */
export function formatContextUsage(usage: TokenUsage): string {
  const used = contextUsed(usage);
  if (used <= 0 && !usage.contextWindow) {
    return "";
  }
  const usedLabel = formatTokens(used);
  return usage.contextWindow ? `${usedLabel} / ${formatTokens(usage.contextWindow)}` : usedLabel;
}

export function usageRatio(usage: TokenUsage): number | undefined {
  if (!usage.contextWindow) {
    return undefined;
  }
  return Math.min(1, contextUsed(usage) / usage.contextWindow);
}

/** Hover text: input / cache / output / window. */
export function usageDetail(usage: TokenUsage): string {
  const bits = [`输入 ${formatTokens(usage.inputTokens)}`];
  if (usage.cacheReadTokens) {
    bits.push(`缓存读取 ${formatTokens(usage.cacheReadTokens)}`);
  }
  if (usage.cacheWriteTokens) {
    bits.push(`缓存写入 ${formatTokens(usage.cacheWriteTokens)}`);
  }
  if (usage.outputTokens) {
    bits.push(`输出 ${formatTokens(usage.outputTokens)}`);
  }
  if (usage.contextWindow) {
    bits.push(`窗口 ${formatTokens(usage.contextWindow)}`);
  }
  if (usage.costUsd !== undefined) {
    bits.push(`$${usage.costUsd.toFixed(4)}`);
  }
  return bits.join(" · ");
}

export function mergeUsage(previous: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!previous) {
    return next;
  }
  return {
    inputTokens: next.inputTokens || previous.inputTokens,
    outputTokens: next.outputTokens || previous.outputTokens,
    cacheReadTokens: next.cacheReadTokens || previous.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens || previous.cacheWriteTokens,
    reasoningTokens: next.reasoningTokens || previous.reasoningTokens,
    totalTokens: next.totalTokens || previous.totalTokens,
    contextWindow: next.contextWindow ?? previous.contextWindow,
    costUsd: next.costUsd ?? previous.costUsd,
  };
}

/**
 * Accept the shapes Cursor, Claude, Codex and Grok emit: snake_case or
 * camelCase, cache as a separate bucket or as a subset of input.
 */
export function parseUsage(raw: unknown): TokenUsage | undefined {
  const record = unwrapUsage(raw);
  if (!record) {
    return undefined;
  }
  const input = numberOf(record, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
  const output = numberOf(record, "output_tokens", "outputTokens", "completion_tokens", "completionTokens");
  const cacheRead = numberOf(record, "cache_read_tokens", "cacheReadTokens", "cache_read_input_tokens", "cacheReadInputTokens");
  const cacheWrite = numberOf(record, "cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens", "cacheCreationInputTokens");
  const total = numberOf(record, "total_tokens", "totalTokens");
  const reasoning = numberOf(record, "reasoning_tokens", "reasoningTokens");
  const window = numberOf(record, "context_window", "contextWindow", "max_context_tokens", "maxContextTokens");
  const cost = numberOf(record, "cost_usd", "costUsd", "total_cost_usd", "totalCostUsd");
  if (!input && !output && !cacheRead && !cacheWrite && !total && !window) {
    return undefined;
  }
  const usage: TokenUsage = {
    inputTokens: input,
    outputTokens: output,
  };
  if (cacheRead) {
    usage.cacheReadTokens = cacheRead;
  }
  if (cacheWrite) {
    usage.cacheWriteTokens = cacheWrite;
  }
  if (reasoning) {
    usage.reasoningTokens = reasoning;
  }
  if (total) {
    usage.totalTokens = total;
  }
  if (window) {
    usage.contextWindow = window;
  }
  if (cost) {
    usage.costUsd = cost;
  }
  return usage;
}

/** `modelUsage.grok-4.6.contextWindow` from Grok's `end` / result payload. */
export function contextWindowFromModelUsage(raw: unknown): number | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) {
      continue;
    }
    const window = numberOf(value, "contextWindow", "context_window");
    if (window) {
      return window;
    }
  }
  return undefined;
}

/**
 * Window size encoded on a model id (`context=200k`, `200k`, `1m`) or a
 * well-known family default when the CLI did not report one.
 */
export function inferContextWindow(...hints: Array<string | undefined>): number | undefined {
  for (const hint of hints) {
    const fromText = windowFromText(hint);
    if (fromText) {
      return fromText;
    }
  }
  for (const hint of hints) {
    const fromFamily = windowFromFamily(hint);
    if (fromFamily) {
      return fromFamily;
    }
  }
  return undefined;
}

function unwrapUsage(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (isRecord(raw.usage)) {
    return raw.usage;
  }
  if (isRecord(raw.tokenUsage)) {
    return raw.tokenUsage;
  }
  if (isRecord(raw._meta) && (isRecord(raw._meta.usage) || isRecord(raw._meta.tokenUsage))) {
    return isRecord(raw._meta.usage) ? raw._meta.usage : (raw._meta.tokenUsage as Record<string, unknown>);
  }
  return raw;
}

function numberOf(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}

function windowFromText(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const named = /(?:context|ctx|window)\s*[=:]\s*(\d+(?:\.\d+)?)\s*([km])\b/i.exec(value);
  if (named) {
    return scaleWindow(Number(named[1]), named[2]);
  }
  const sized = /(?:^|[\[\s,.-])(\d+(?:\.\d+)?)([km])(?:\s*(?:ctx|context|window))?(?=$|[\]\s,.-])/i.exec(value);
  if (sized) {
    return scaleWindow(Number(sized[1]), sized[2]);
  }
  return undefined;
}

function windowFromFamily(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const id = value.toLowerCase();
  for (const [pattern, size] of FAMILY_WINDOWS) {
    if (pattern.test(id)) {
      return size;
    }
  }
  return undefined;
}

function scaleWindow(value: number, unit: string | undefined): number | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const letter = (unit ?? "").toLowerCase();
  if (letter === "m") {
    return Math.round(value * 1_000_000);
  }
  if (letter === "k") {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

const FAMILY_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/claude-opus-5|opus-5/, 300_000],
  [/claude-sonnet|sonnet-4|sonnet/, 200_000],
  [/claude-haiku|haiku/, 200_000],
  [/gpt-5\.5/, 272_000],
  [/gpt-5/, 256_000],
  [/grok-4|cursor grok|cursor-grok/, 256_000],
  [/composer/, 200_000],
];
