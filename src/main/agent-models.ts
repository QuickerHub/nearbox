import type { AgentKind, AgentModel } from "@shared/protocol";

// How each CLI is asked for its model catalog and how the answer is read.
// Pure helpers (no Node imports) so they stay unit-testable; running the
// command lives in agents.ts.

/** Arguments that make the CLI print its catalog and exit. Absent for CLIs that cannot. */
export const MODEL_LIST_ARGS: Partial<Record<AgentKind, string[]>> = {
  cursor: ["--list-models"],
  codex: ["debug", "models"],
  grok: ["models"],
  opencode: ["models"],
};

export function parseModelList(kind: AgentKind, stdout: string): AgentModel[] {
  switch (kind) {
    case "cursor":
      return parseCursorModels(stdout);
    case "codex":
      return parseCodexModels(stdout);
    case "grok":
      return parseGrokModels(stdout);
    case "opencode":
      return parseOpencodeModels(stdout);
    case "claude":
      return [];
  }
}

/**
 * `cursor-agent --list-models`:
 *   Available models
 *
 *   auto - Auto (default)
 *   gpt-5.5-high - GPT-5.5 1M High
 *   ...
 *   Tip: use --model <id> ...
 */
function parseCursorModels(stdout: string): AgentModel[] {
  const out: AgentModel[] = [];
  for (const raw of lines(stdout)) {
    const match = /^(\S+)\s+-\s+(.+)$/.exec(raw);
    if (!match) {
      continue;
    }
    const id = match[1]!;
    let label = match[2]!.trim();
    let isDefault = false;
    // Markers come last, possibly both: "Auto (default) (current)".
    for (;;) {
      const marker = /\s*\((default|current)\)$/i.exec(label);
      if (!marker) {
        break;
      }
      if (marker[1]!.toLowerCase() === "default") {
        isDefault = true;
      }
      label = label.slice(0, marker.index).trim();
    }
    pushModel(out, { id, label: label || undefined, isDefault: isDefault || undefined });
  }
  return out;
}

/**
 * `codex debug models` prints one JSON document: `{ "models": [ { "slug", "display_name", "visibility", ... } ] }`.
 * Hidden entries are internal (auto-review, reserves) and not meant for `-m`.
 */
function parseCodexModels(stdout: string): AgentModel[] {
  const start = stdout.indexOf("{");
  if (start === -1) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
  const list = parsed && typeof parsed === "object" ? (parsed as { models?: unknown }).models : undefined;
  if (!Array.isArray(list)) {
    return [];
  }
  const out: AgentModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.slug === "string" ? record.slug.trim() : "";
    if (!id || record.visibility === "hide") {
      continue;
    }
    pushModel(out, { id, label: typeof record.display_name === "string" && record.display_name.trim() ? record.display_name.trim() : undefined });
  }
  return out;
}

/**
 * `grok models`:
 *   Default model: grok-4.6
 *
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 */
function parseGrokModels(stdout: string): AgentModel[] {
  const out: AgentModel[] = [];
  for (const raw of lines(stdout)) {
    const match = /^[*•-]\s+(\S+)(?:\s+\((default|current)\))?$/i.exec(raw);
    if (!match) {
      continue;
    }
    pushModel(out, { id: match[1]!, isDefault: match[2]?.toLowerCase() === "default" || undefined });
  }
  return out;
}

/** `opencode models`: one `provider/model` per line, nothing else worth keeping. */
function parseOpencodeModels(stdout: string): AgentModel[] {
  const out: AgentModel[] = [];
  for (const raw of lines(stdout)) {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s]+$/.test(raw)) {
      pushModel(out, { id: raw });
    }
  }
  return out;
}

function lines(stdout: string): string[] {
  return stdout
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function pushModel(into: AgentModel[], model: AgentModel): void {
  if (into.some((item) => item.id === model.id)) {
    return;
  }
  const clean: AgentModel = { id: model.id };
  if (model.label) {
    clean.label = model.label;
  }
  if (model.isDefault) {
    clean.isDefault = true;
  }
  into.push(clean);
}
