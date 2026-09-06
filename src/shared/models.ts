import type { AgentInfo, AgentKind, AgentModel } from "./protocol";

// What the model picker offers when the CLI has not (or cannot) told us its
// catalog. Runtime-import free so the renderer can unit-test around it.

/** CLIs that can print their model catalog; the others only take free text. */
export const AGENTS_LISTING_MODELS: readonly AgentKind[] = ["cursor", "codex", "grok", "opencode"];

/**
 * Fallback catalogs. Kept short on purpose: the live list from the CLI
 * replaces them on machines where it can be fetched, and the picker always
 * accepts a typed id.
 */
export const BUILTIN_MODELS: Record<AgentKind, AgentModel[]> = {
  cursor: [{ id: "auto", label: "Auto", isDefault: true }],
  codex: [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  ],
  grok: [
    { id: "grok-4.6", label: "Grok 4.6", isDefault: true },
    { id: "grok-4.5", label: "Grok 4.5" },
  ],
  claude: [
    { id: "sonnet", label: "Sonnet（最新）" },
    { id: "opus", label: "Opus（最新）" },
    { id: "haiku", label: "Haiku（最新）" },
    { id: "opusplan", label: "Opus 规划 · Sonnet 执行" },
  ],
  opencode: [],
};

export function canListModels(kind: AgentKind): boolean {
  return AGENTS_LISTING_MODELS.includes(kind);
}

/** A catalog older than this is refreshed the next time someone is about to pick from it. */
export const MODELS_STALE_MS = 60 * 60 * 1000;

/**
 * Whether it is worth asking the CLI again before the user picks a model:
 * nothing fetched yet, the last fetch failed, or the list is simply old.
 * The host rate-limits the actual fetches, so callers may ask freely.
 */
export function modelsNeedRefresh(info: Pick<AgentInfo, "kind" | "available" | "models" | "modelsCheckedAt" | "modelsError">, now = Date.now()): boolean {
  if (!info.available || !canListModels(info.kind)) {
    return false;
  }
  if (!info.models?.length || info.modelsError) {
    return true;
  }
  const checked = info.modelsCheckedAt ? Date.parse(info.modelsCheckedAt) : Number.NaN;
  return !Number.isFinite(checked) || now - checked > MODELS_STALE_MS;
}

/** The catalog to show for an agent: what its CLI reported, else the built-in fallback. */
export function modelsForAgent(kind: AgentKind, info: Pick<AgentInfo, "models"> | undefined): AgentModel[] {
  return info?.models?.length ? info.models : BUILTIN_MODELS[kind];
}

/** Display name for a model id: the catalog label when known, the id otherwise. */
export function modelLabel(models: readonly AgentModel[], id: string): string {
  const match = models.find((model) => model.id === id);
  return match?.label || id;
}

/** Case-insensitive match of every word in `query` against a model's id and label. */
export function filterModels(models: readonly AgentModel[], query: string): AgentModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [...models];
  }
  return models.filter((model) => {
    const haystack = `${model.id} ${model.label ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A model id as typed by the user, or undefined when it is not usable on a command line. */
export function normalizeModelId(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!text || text.length > 200 || /[\r\n\u0000]/.test(text)) {
    return undefined;
  }
  return text;
}
