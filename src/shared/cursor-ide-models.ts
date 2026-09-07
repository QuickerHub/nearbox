import type { IdeModelPref } from "./protocol";

/**
 * Cursor IDE keeps the Settings → Models toggle list in its
 * `applicationUser` blob (`availableDefaultModels2`, plus the user's
 * `modelOverrideEnabled` / `modelOverrideDisabled`). Family ids look like
 * `grok-4.6` / `claude-opus-5`, matching `cursor-agent --list-models` after
 * the `cursor-` prefix and thinking/effort suffixes are stripped.
 */

export function parseCursorIdeModels(applicationUser: unknown): IdeModelPref[] | undefined {
  if (!applicationUser || typeof applicationUser !== "object") {
    return undefined;
  }
  const data = applicationUser as Record<string, unknown>;
  const catalog = data.availableDefaultModels2;
  if (!Array.isArray(catalog) || !catalog.length) {
    return undefined;
  }
  const ai = data.aiSettings && typeof data.aiSettings === "object" ? (data.aiSettings as Record<string, unknown>) : {};
  const enabled = new Set(stringList(ai.modelOverrideEnabled).map(normalizeIdeModelId));
  const disabled = new Set(stringList(ai.modelOverrideDisabled).map(normalizeIdeModelId));
  const out: IdeModelPref[] = [];
  const seen = new Set<string>();
  for (const item of catalog) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const raw = typeof record.name === "string" ? record.name : typeof record.serverModelName === "string" ? record.serverModelName : "";
    const id = normalizeIdeModelId(raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const defaultOn = record.defaultOn === true;
    const visible = (defaultOn || enabled.has(id)) && !disabled.has(id);
    const pref: IdeModelPref = { id, visible };
    if (typeof record.clientDisplayName === "string" && record.clientDisplayName.trim()) {
      pref.label = record.clientDisplayName.trim();
    }
    out.push(pref);
  }
  return out.length ? out : undefined;
}

export function normalizeIdeModelId(id: string): string {
  return id.trim().toLowerCase().replace(/^cursor-/, "");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
