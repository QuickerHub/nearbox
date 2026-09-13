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
  const parsed = parseLeadingJsonObject(stdout);
  if (!parsed) {
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
    const match = /^[*•-]\s+(\S+)(.*)$/.exec(raw);
    if (!match) {
      continue;
    }
    let rest = match[2] ?? "";
    let isDefault = false;
    // Markers come last, possibly both: "grok-4.6 (default) (current)".
    for (;;) {
      const marker = /\s*\((default|current)\)$/i.exec(rest);
      if (!marker) {
        break;
      }
      if (marker[1]!.toLowerCase() === "default") {
        isDefault = true;
      }
      rest = rest.slice(0, marker.index).trimEnd();
    }
    if (rest.trim()) {
      // Not a bare model bullet (e.g. prose after the id).
      continue;
    }
    pushModel(out, { id: match[1]!, isDefault: isDefault || undefined });
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

/** First top-level JSON object in `text`, tolerant of leading logs and trailing chatter. */
function parseLeadingJsonObject(text: string): unknown | undefined {
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf("{", from);
    if (start === -1) {
      return undefined;
    }
    const parsed = parseJsonObjectAt(text, start);
    if (parsed !== undefined) {
      return parsed;
    }
    from = start + 1;
  }
  return undefined;
}

function parseJsonObjectAt(text: string, start: number): unknown | undefined {
  try {
    return JSON.parse(text.slice(start));
  } catch {
    // fall through: may be a false `{` in a log line, or trailing chatter
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
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
