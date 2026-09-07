import type { AgentModel, IdeModelPref } from "./protocol";

/**
 * How cursor-agent (and similar CLIs) encode thinking depth and speed on a
 * model id: `claude-opus-5-thinking-max`, `gpt-5.5-high-fast`,
 * `claude-opus-5[thinking=true,effort=high,fast=false]`.
 *
 * Suffixes are read from the end: [-thinking][-level][-fast], with
 * "extra-high" counting as one level. The leftover is the family id.
 */

export const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const EFFORT_SET = new Set<string>(EFFORT_LEVELS);

/** A thinking-depth slot on a family: no suffix, bare "thinking", or an effort level. */
export type ThinkingDepth =
  | { kind: "default" }
  | { kind: "thinking" }
  | { kind: "effort"; effort: EffortLevel };

export interface ModelAlias {
  /** Family id with suffixes stripped, e.g. "claude-opus-5". */
  base: string;
  thinking: boolean;
  effort?: EffortLevel;
  fast: boolean;
}

export interface ModelVariant extends AgentModel {
  alias: ModelAlias;
}

export interface ModelFamily {
  key: string;
  label: string;
  variants: ModelVariant[];
  depths: ThinkingDepth[];
  /** The family lists both a fast and a non-fast variant for at least one depth. */
  hasFastToggle: boolean;
}

const DEPTH_ORDER: Record<string, number> = {
  default: 0,
  thinking: 1,
  none: 2,
  minimal: 3,
  low: 4,
  medium: 5,
  high: 6,
  xhigh: 7,
  max: 8,
};

const DEPTH_LABELS: Record<string, string> = {
  default: "默认",
  thinking: "Thinking",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** Words the CLI puts on a variant label that belong to depth/speed, not the family. */
const LABEL_MODIFIERS =
  /\b(?:thinking|fast|extra[-\s]?high|xhigh|minimal|none|low|medium|high|max|1m|200k|272k|300k)\b/gi;

export function parseEffort(value: string | undefined): EffortLevel | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  if (normalized === "extra-high" || normalized === "extra_high") {
    return "xhigh";
  }
  return EFFORT_SET.has(normalized) ? (normalized as EffortLevel) : undefined;
}

/**
 * Split a model id into family + thinking + effort + fast. Unknown ids still
 * parse as a family with no modifiers, so the picker can always group them.
 */
export function parseModelAlias(id: string): ModelAlias | undefined {
  const raw = id.trim();
  if (!raw) {
    return undefined;
  }
  const bracket = /^([^[]+)\[(.*)\]$/.exec(raw);
  if (bracket) {
    const params = presetParams(bracket[2]!);
    return {
      base: normalizeBase(bracket[1]!),
      thinking: params.get("thinking") === "true",
      effort: parseEffort(params.get("effort") ?? params.get("reasoning") ?? params.get("reasoning_effort")),
      fast: params.get("fast") === "true",
    };
  }
  const tokens = raw.toLowerCase().split("-").filter(Boolean);
  let fast = false;
  let thinking = false;
  let effort: EffortLevel | undefined;
  for (;;) {
    const last = tokens.at(-1);
    if (last === "fast" && !fast) {
      fast = true;
      tokens.pop();
    } else if (last === "thinking" && !thinking) {
      thinking = true;
      tokens.pop();
    } else if (last === "high" && tokens.at(-2) === "extra" && !effort) {
      effort = "xhigh";
      tokens.splice(-2, 2);
    } else if (last && EFFORT_SET.has(last) && !effort) {
      effort = last as EffortLevel;
      tokens.pop();
    } else {
      break;
    }
  }
  const base = tokens.join("-");
  if (!base) {
    return undefined;
  }
  return { base, thinking, effort, fast };
}

export function depthOf(alias: ModelAlias): ThinkingDepth {
  if (alias.effort) {
    return { kind: "effort", effort: alias.effort };
  }
  if (alias.thinking) {
    return { kind: "thinking" };
  }
  return { kind: "default" };
}

export function depthKey(depth: ThinkingDepth): string {
  return depth.kind === "effort" ? depth.effort : depth.kind;
}

export function sameDepth(a: ThinkingDepth, b: ThinkingDepth): boolean {
  return depthKey(a) === depthKey(b);
}

export function depthLabel(depth: ThinkingDepth): string {
  return DEPTH_LABELS[depthKey(depth)] ?? depthKey(depth);
}

export function compareDepths(a: ThinkingDepth, b: ThinkingDepth): number {
  return (DEPTH_ORDER[depthKey(a)] ?? 50) - (DEPTH_ORDER[depthKey(b)] ?? 50);
}

/** Fold a catalog into families that share a base id and differ only by depth/fast. */
export function groupModelFamilies(models: readonly AgentModel[]): ModelFamily[] {
  const order: string[] = [];
  const buckets = new Map<string, ModelVariant[]>();
  for (const model of models) {
    const alias = parseModelAlias(model.id);
    if (!alias) {
      continue;
    }
    const variant: ModelVariant = { ...model, alias };
    const list = buckets.get(alias.base);
    if (list) {
      if (!list.some((item) => item.id === model.id)) {
        list.push(variant);
      }
    } else {
      buckets.set(alias.base, [variant]);
      order.push(alias.base);
    }
  }
  return order.map((key) => {
    const variants = buckets.get(key)!;
    const depths = uniqueDepths(variants);
    return {
      key,
      label: familyLabel(key, variants),
      variants,
      depths,
      hasFastToggle: familyHasFastToggle(variants),
    };
  });
}

export function findFamily(families: readonly ModelFamily[], id: string): ModelFamily | undefined {
  if (!id) {
    return undefined;
  }
  return families.find((family) => family.variants.some((item) => item.id === id)) ?? matchByAlias(families, id);
}

/** True when at least one family has more than one listed variant — worth the Cursor-style picker. */
export function familiesAreFoldable(families: readonly ModelFamily[]): boolean {
  return families.some((family) => family.variants.length > 1);
}

/**
 * Compact chip text: family name plus the depth/fast that are not obvious.
 * "claude-opus-5-thinking-max" → "Claude Opus 5 · Max".
 */
export function compactModelLabel(models: readonly AgentModel[], id: string): string {
  if (!id) {
    return "";
  }
  const families = groupModelFamilies(models);
  const family = findFamily(families, id);
  if (!family) {
    return models.find((model) => model.id === id)?.label || id;
  }
  const variant = family.variants.find((item) => item.id === id);
  const alias = variant?.alias ?? parseModelAlias(id);
  if (!alias) {
    return family.label;
  }
  const bits = [family.label];
  const depth = depthOf(alias);
  if (family.depths.length > 1 && depth.kind !== "default") {
    bits.push(depthLabel(depth));
  }
  if (alias.fast) {
    bits.push("Fast");
  }
  return bits.join(" · ");
}

export function filterFamilies(families: readonly ModelFamily[], query: string): ModelFamily[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [...families];
  }
  return families.filter((family) => {
    const haystack = [family.key, family.label, ...family.variants.flatMap((item) => [item.id, item.label ?? ""])]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Cursor-style catalog: Auto is listed separately, current-gen families stay
 * visible, and superseded versions of the same line go behind "更旧的模型".
 * Searching returns every match and skips the fold.
 */
export function presentFamilies(
  families: readonly ModelFamily[],
  query: string,
  selectedId = "",
  idePrefs?: readonly IdeModelPref[],
): { current: ModelFamily[]; older: ModelFamily[] } {
  const filtered = sortFamilies(filterFamilies(families, query), selectedId, idePrefs).filter((family) => !isAutoFamily(family));
  if (query.trim()) {
    return { current: filtered, older: [] };
  }
  if (idePrefs?.length) {
    return partitionByIdePrefs(filtered, selectedId, idePrefs);
  }
  const newest = newestVersionByLineage(filtered);
  const current: ModelFamily[] = [];
  const older: ModelFamily[] = [];
  for (const family of filtered) {
    if (isCurrentFamily(family, selectedId, newest)) {
      current.push(family);
    } else {
      older.push(family);
    }
  }
  return { current, older };
}

/** Sort like Cursor: selected first, then product models, then newest of each line. */
export function sortFamilies(families: readonly ModelFamily[], selectedId = "", idePrefs?: readonly IdeModelPref[]): ModelFamily[] {
  const selected = selectedId ? findFamily(families, selectedId)?.key : undefined;
  const ideIndex = idePrefIndex(idePrefs);
  return [...families].sort((a, b) => {
    if (selected) {
      if (a.key === selected && b.key !== selected) {
        return -1;
      }
      if (b.key === selected && a.key !== selected) {
        return 1;
      }
    }
    if (ideIndex) {
      const ia = ideIndex.get(familyIdeKey(a)) ?? 10_000;
      const ib = ideIndex.get(familyIdeKey(b)) ?? 10_000;
      if (ia !== ib) {
        return ia - ib;
      }
    }
    const ra = rankFamily(a);
    const rb = rankFamily(b);
    if (ra.pin !== rb.pin) {
      return rb.pin - ra.pin;
    }
    const versions = compareVersion(rb.version, ra.version);
    if (versions) {
      return versions;
    }
    return a.label.localeCompare(b.label, "en");
  });
}

export function familyMatchesIdeId(family: Pick<ModelFamily, "key" | "label" | "variants">, id: string): boolean {
  const want = normalizeIdeId(id);
  if (want === "default" || want === "auto") {
    return isAutoFamily(family);
  }
  if (familyIdeKey(family) === want) {
    return true;
  }
  return family.variants.some((item) => normalizeIdeId(parseModelAlias(item.id)?.base ?? item.id) === want);
}

export function idePrefForFamily(family: Pick<ModelFamily, "key" | "label" | "variants">, prefs: readonly IdeModelPref[] | undefined): IdeModelPref | undefined {
  return prefs?.find((pref) => familyMatchesIdeId(family, pref.id));
}

export function isAutoFamily(family: Pick<ModelFamily, "key" | "label">): boolean {
  return family.key === "auto" || family.label.trim().toLowerCase() === "auto";
}

function normalizeIdeId(id: string): string {
  return id.trim().toLowerCase().replace(/^cursor-/, "");
}

function familyIdeKey(family: Pick<ModelFamily, "key" | "variants">): string {
  return normalizeIdeId(family.key);
}

function idePrefIndex(prefs: readonly IdeModelPref[] | undefined): Map<string, number> | undefined {
  if (!prefs?.length) {
    return undefined;
  }
  const index = new Map<string, number>();
  prefs.forEach((pref, order) => {
    const id = normalizeIdeId(pref.id);
    if (!index.has(id)) {
      index.set(id, order);
    }
  });
  return index;
}

function partitionByIdePrefs(
  families: readonly ModelFamily[],
  selectedId: string,
  prefs: readonly IdeModelPref[],
): { current: ModelFamily[]; older: ModelFamily[] } {
  const current: ModelFamily[] = [];
  const older: ModelFamily[] = [];
  for (const family of families) {
    const pref = idePrefForFamily(family, prefs);
    const selected = Boolean(selectedId && (family.variants.some((item) => item.id === selectedId) || family.key === parseModelAlias(selectedId)?.base));
    if (selected || pref?.visible) {
      current.push(family);
    } else {
      older.push(family);
    }
  }
  return { current, older };
}

/** Same-line muted suffix Cursor shows: "Claude Opus 5" + "Max". */
export function familyHint(family: ModelFamily): string {
  const headline = [...family.variants].sort((a, b) => compareDepths(depthOf(b.alias), depthOf(a.alias)))[0];
  if (!headline) {
    return "";
  }
  const depth = depthOf(headline.alias);
  const atDepth = family.variants.filter((item) => sameDepth(depthOf(item.alias), depth));
  const bits: string[] = [];
  if (depth.kind !== "default") {
    bits.push(depthLabel(depth));
  }
  const onlyFast = atDepth.length > 0 && atDepth.every((item) => item.alias.fast);
  const defaultFast = depth.kind === "default" && atDepth.some((item) => item.alias.fast);
  if (onlyFast || defaultFast) {
    bits.push("Fast");
  }
  return bits.join(" ");
}

const LINEAGE_PIN: Record<string, number> = {
  composer: 90,
  "cursor-grok": 80,
  grok: 75,
  "claude-opus": 70,
  gpt: 60,
  "claude-fable": 50,
  gemini: 42,
  "gemini-flash": 40,
  "gemini-pro": 38,
  "claude-sonnet": 30,
  "claude-haiku": 20,
};

const BRANDS = ["claude", "gpt", "gemini", "composer", "grok", "kimi", "codex"] as const;
const TIERS = ["opus", "sonnet", "haiku", "fable", "flash", "pro", "mini", "nano", "codex", "sol", "terra", "spark"] as const;

interface FamilyRank {
  lineage: string;
  version: number[];
  pin: number;
}

function rankFamily(family: ModelFamily): FamilyRank {
  if (isAutoFamily(family)) {
    return { lineage: "auto", version: [], pin: 100 };
  }
  const tokens = family.key.toLowerCase().split(/[-._]/).filter(Boolean);
  const version = extractVersion(tokens);
  let brand = BRANDS.find((item) => tokens.includes(item));
  if (tokens[0] === "cursor" && tokens[1] === "grok") {
    return { lineage: "cursor-grok", version, pin: LINEAGE_PIN["cursor-grok"] ?? 0 };
  }
  if (tokens[0] === "composer" || brand === "composer") {
    return { lineage: "composer", version, pin: LINEAGE_PIN.composer };
  }
  const tier = TIERS.find((item) => tokens.includes(item));
  if (brand === "gpt") {
    return { lineage: "gpt", version, pin: LINEAGE_PIN.gpt };
  }
  if (brand === "gemini") {
    const lineage = tier ? `gemini-${tier}` : "gemini";
    return { lineage, version, pin: LINEAGE_PIN[lineage] ?? LINEAGE_PIN.gemini };
  }
  if (brand === "claude" && tier) {
    const lineage = `claude-${tier}`;
    return { lineage, version, pin: LINEAGE_PIN[lineage] ?? 10 };
  }
  if (!brand && tokens[0] === "cursor") {
    brand = BRANDS.find((item) => tokens.includes(item));
  }
  const lineage = [brand, tier].filter(Boolean).join("-") || family.key;
  return { lineage, version, pin: LINEAGE_PIN[lineage] ?? 0 };
}

function extractVersion(tokens: readonly string[]): number[] {
  for (const token of tokens) {
    if (/^\d+\.\d+/.test(token)) {
      return token.split(".").filter((part) => /^\d+$/.test(part)).map(Number);
    }
  }
  const nums: number[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      nums.push(Number(token));
    }
  }
  return nums.slice(0, 2);
}

function compareVersion(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta) {
      return delta;
    }
  }
  return 0;
}

function newestVersionByLineage(families: readonly ModelFamily[]): Map<string, number[]> {
  const newest = new Map<string, number[]>();
  for (const family of families) {
    const { lineage, version } = rankFamily(family);
    const prev = newest.get(lineage);
    if (!prev || compareVersion(version, prev) > 0) {
      newest.set(lineage, version);
    }
  }
  return newest;
}

function isCurrentFamily(family: ModelFamily, selectedId: string, newest: Map<string, number[]>): boolean {
  if (selectedId && (family.variants.some((item) => item.id === selectedId) || family.key === parseModelAlias(selectedId)?.base)) {
    return true;
  }
  const { lineage, version } = rankFamily(family);
  const top = newest.get(lineage);
  return !top || compareVersion(version, top) === 0;
}

/** The listed variant that matches the wanted depth and speed, with sensible fallbacks. */
export function pickVariant(family: ModelFamily, depth: ThinkingDepth, fast: boolean): AgentModel {
  const atDepth = family.variants.filter((item) => sameDepth(depthOf(item.alias), depth));
  const pool = atDepth.length ? atDepth : family.variants;
  return pool.find((item) => item.alias.fast === fast) ?? pool[0] ?? family.variants[0]!;
}

/**
 * When jumping to another family, keep the current depth/fast if that family
 * has them; otherwise fall back to its simplest (or CLI-default) variant.
 */
export function pickInFamily(family: ModelFamily, prefer?: { depth?: ThinkingDepth; fast?: boolean }): AgentModel {
  if (prefer?.depth && family.depths.some((depth) => sameDepth(depth, prefer.depth!))) {
    return pickVariant(family, prefer.depth, prefer.fast === true);
  }
  const fallback =
    family.variants.find((item) => item.isDefault) ??
    family.variants.find((item) => !item.alias.fast && !item.alias.effort && !item.alias.thinking) ??
    family.variants[0]!;
  if (prefer?.fast) {
    return pickVariant(family, depthOf(fallback.alias), true);
  }
  return fallback;
}

export function variantCanToggleFast(family: ModelFamily, depth: ThinkingDepth): boolean {
  const atDepth = family.variants.filter((item) => sameDepth(depthOf(item.alias), depth));
  return atDepth.some((item) => item.alias.fast) && atDepth.some((item) => !item.alias.fast);
}

function matchByAlias(families: readonly ModelFamily[], id: string): ModelFamily | undefined {
  const alias = parseModelAlias(id);
  return alias ? families.find((family) => family.key === alias.base) : undefined;
}

function uniqueDepths(variants: readonly ModelVariant[]): ThinkingDepth[] {
  const seen = new Set<string>();
  const depths: ThinkingDepth[] = [];
  for (const variant of variants) {
    const depth = depthOf(variant.alias);
    const key = depthKey(depth);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    depths.push(depth);
  }
  depths.sort(compareDepths);
  return depths;
}

function familyHasFastToggle(variants: readonly ModelVariant[]): boolean {
  const byDepth = new Map<string, { fast: boolean; slow: boolean }>();
  for (const variant of variants) {
    const key = depthKey(depthOf(variant.alias));
    const slot = byDepth.get(key) ?? { fast: false, slow: false };
    if (variant.alias.fast) {
      slot.fast = true;
    } else {
      slot.slow = true;
    }
    byDepth.set(key, slot);
  }
  return [...byDepth.values()].some((slot) => slot.fast && slot.slow);
}

function familyLabel(base: string, variants: readonly ModelVariant[]): string {
  const cleaned = variants
    .map((item) => (item.label ? cleanFamilyLabel(item.label) : ""))
    .filter(Boolean);
  const counts = new Map<string, number>();
  for (const label of cleaned) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount || (count === bestCount && label.length < best.length)) {
      best = label;
      bestCount = count;
    }
  }
  return best || titleFromId(base);
}

export function cleanFamilyLabel(label: string): string {
  return label
    .replace(LABEL_MODIFIERS, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/[·|,;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromId(base: string): string {
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function normalizeBase(value: string): string {
  return value.trim().toLowerCase();
}

function presetParams(inside: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of inside.split(",")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      params.set(key.trim(), value.trim());
    }
  }
  return params;
}
