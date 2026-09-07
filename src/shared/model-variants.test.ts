import assert from "node:assert/strict";
import test from "node:test";
import {
  compactModelLabel,
  depthLabel,
  depthOf,
  familiesAreFoldable,
  familyHint,
  filterFamilies,
  groupModelFamilies,
  parseModelAlias,
  pickInFamily,
  pickVariant,
  presentFamilies,
  variantCanToggleFast,
} from "./model-variants.ts";

test("suffixes peel off from the end in any order", () => {
  assert.deepEqual(parseModelAlias("claude-opus-5-thinking-max"), {
    base: "claude-opus-5",
    thinking: true,
    effort: "max",
    fast: false,
  });
  assert.deepEqual(parseModelAlias("claude-opus-5-thinking-high-fast"), {
    base: "claude-opus-5",
    thinking: true,
    effort: "high",
    fast: true,
  });
  assert.deepEqual(parseModelAlias("claude-4.6-sonnet-medium-thinking"), {
    base: "claude-4.6-sonnet",
    thinking: true,
    effort: "medium",
    fast: false,
  });
  assert.deepEqual(parseModelAlias("gpt-5.5-extra-high-fast"), {
    base: "gpt-5.5",
    thinking: false,
    effort: "xhigh",
    fast: true,
  });
  assert.deepEqual(parseModelAlias("composer-2.5-fast"), {
    base: "composer-2.5",
    thinking: false,
    effort: undefined,
    fast: true,
  });
  assert.deepEqual(parseModelAlias("auto"), {
    base: "auto",
    thinking: false,
    effort: undefined,
    fast: false,
  });
  assert.equal(parseModelAlias(""), undefined);
  assert.equal(parseModelAlias("   "), undefined);
});

test("parameterized ids carry thinking, effort and fast", () => {
  assert.deepEqual(parseModelAlias("claude-opus-5[thinking=true,context=300k,effort=high,fast=false]"), {
    base: "claude-opus-5",
    thinking: true,
    effort: "high",
    fast: false,
  });
  assert.deepEqual(parseModelAlias("kimi-k3[reasoning=max]"), {
    base: "kimi-k3",
    thinking: false,
    effort: "max",
    fast: false,
  });
});

test("families fold variants that differ only by thinking depth and fast", () => {
  const families = groupModelFamilies([
    { id: "auto", label: "Auto", isDefault: true },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "gpt-5.5-extra-high", label: "GPT-5.5 1M Extra High" },
    { id: "gpt-5.5-high-fast", label: "GPT-5.5 1M High Fast" },
    { id: "claude-opus-5", label: "Claude Opus 5 1M" },
    { id: "claude-opus-5-thinking", label: "Claude Opus 5 1M Thinking" },
    { id: "claude-opus-5-thinking-high", label: "Claude Opus 5 1M Thinking High" },
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 1M Max Thinking" },
    { id: "claude-opus-5-thinking-high-fast", label: "Claude Opus 5 1M Thinking Fast" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "cursor-grok-4.6-high-fast", label: "Cursor Grok 4.6 High Fast" },
  ]);

  assert.equal(familiesAreFoldable(families), true);
  assert.deepEqual(
    families.map((family) => family.key),
    ["auto", "gpt-5.5", "claude-opus-5", "composer-2.5", "cursor-grok-4.6"],
  );
  assert.equal(families.find((family) => family.key === "gpt-5.5")?.label, "GPT-5.5");
  assert.equal(families.find((family) => family.key === "claude-opus-5")?.label, "Claude Opus 5");
  assert.equal(families.find((family) => family.key === "composer-2.5")?.label, "Composer 2.5");
  assert.equal(families.find((family) => family.key === "cursor-grok-4.6")?.label, "Cursor Grok 4.6");

  const opus = families.find((family) => family.key === "claude-opus-5")!;
  assert.deepEqual(
    opus.depths.map((depth) => depthLabel(depth)),
    ["默认", "Thinking", "High", "Max"],
  );
  assert.equal(opus.hasFastToggle, true);
  assert.equal(variantCanToggleFast(opus, { kind: "effort", effort: "high" }), true);
  assert.equal(variantCanToggleFast(opus, { kind: "effort", effort: "max" }), false);

  const grok = families.find((family) => family.key === "cursor-grok-4.6")!;
  assert.equal(grok.hasFastToggle, false);
  assert.equal(families.find((family) => family.key === "auto")?.hasFastToggle, false);
});

test("a catalog of unique models is not foldable", () => {
  const families = groupModelFamilies([
    { id: "sonnet", label: "Sonnet（最新）" },
    { id: "opus", label: "Opus（最新）" },
    { id: "grok-4.6", label: "Grok 4.6" },
  ]);
  assert.equal(familiesAreFoldable(families), false);
  assert.equal(families.length, 3);
});

test("compact labels drop context-window noise and keep the active depth", () => {
  const models = [
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 1M Max Thinking" },
    { id: "claude-opus-5-thinking-high-fast", label: "Claude Opus 5 1M Thinking Fast" },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "gpt-5.5-low", label: "GPT-5.5 1M Low" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "auto", label: "Auto" },
  ];
  assert.equal(compactModelLabel(models, "claude-opus-5-thinking-max"), "Claude Opus 5 · Max");
  assert.equal(compactModelLabel(models, "claude-opus-5-thinking-high-fast"), "Claude Opus 5 · High · Fast");
  assert.equal(compactModelLabel(models, "gpt-5.5-high"), "GPT-5.5 · High");
  assert.equal(compactModelLabel(models, "composer-2.5-fast"), "Composer 2.5 · Fast");
  assert.equal(compactModelLabel(models, "auto"), "Auto");
  assert.equal(compactModelLabel(models, ""), "");
});

test("picking a depth keeps fast when that variant exists, otherwise drops it", () => {
  const [family] = groupModelFamilies([
    { id: "claude-opus-5-thinking-high", label: "High" },
    { id: "claude-opus-5-thinking-high-fast", label: "High Fast" },
    { id: "claude-opus-5-thinking-max", label: "Max" },
  ]);
  assert.equal(pickVariant(family!, { kind: "effort", effort: "high" }, true).id, "claude-opus-5-thinking-high-fast");
  assert.equal(pickVariant(family!, { kind: "effort", effort: "high" }, false).id, "claude-opus-5-thinking-high");
  assert.equal(pickVariant(family!, { kind: "effort", effort: "max" }, true).id, "claude-opus-5-thinking-max");
});

test("switching family keeps the current depth when the other side has it", () => {
  const families = groupModelFamilies([
    { id: "gpt-5.5-high", label: "GPT-5.5 High" },
    { id: "gpt-5.5-low", label: "GPT-5.5 Low" },
    { id: "composer-2.5", label: "Composer 2.5" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
  ]);
  const gpt = families.find((family) => family.key === "gpt-5.5")!;
  const composer = families.find((family) => family.key === "composer-2.5")!;
  assert.equal(pickInFamily(gpt, { depth: { kind: "effort", effort: "high" }, fast: true }).id, "gpt-5.5-high");
  assert.equal(pickInFamily(composer, { depth: { kind: "effort", effort: "high" }, fast: true }).id, "composer-2.5-fast");
  assert.equal(pickInFamily(composer).id, "composer-2.5");
});

test("search matches family name and any variant id", () => {
  const families = groupModelFamilies([
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 1M Max Thinking" },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
  ]);
  assert.deepEqual(
    filterFamilies(families, "opus max").map((family) => family.key),
    ["claude-opus-5"],
  );
  assert.equal(filterFamilies(families, "  ").length, 2);
});

test("depth helpers describe default / thinking / effort", () => {
  assert.deepEqual(depthOf({ base: "x", thinking: false, fast: false }), { kind: "default" });
  assert.deepEqual(depthOf({ base: "x", thinking: true, fast: false }), { kind: "thinking" });
  assert.equal(depthLabel({ kind: "effort", effort: "xhigh" }), "Extra High");
});

test("the catalog sorts like Cursor and folds superseded versions", () => {
  const families = groupModelFamilies([
    { id: "auto", label: "Auto", isDefault: true },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "claude-sonnet-4-6-thinking-high", label: "Claude Sonnet 4.6 High" },
    { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 Thinking" },
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 1M Max Thinking" },
    { id: "gpt-5.6-sol-high", label: "GPT-5.6 Sol High" },
    { id: "gpt-5.6-terra-medium", label: "GPT-5.6 Terra 1M Medium" },
    { id: "claude-fable-5-1-max", label: "Claude Fable 5.1 1M Max" },
    { id: "claude-fable-5-high", label: "Claude Fable 5 High" },
    { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash High" },
    { id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash High" },
    { id: "claude-sonnet-5-high", label: "Claude Sonnet 5 1M High" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
    { id: "cursor-grok-4.6-high-fast", label: "Cursor Grok 4.6 High Fast" },
  ]);
  const { current, older } = presentFamilies(families, "", "cursor-grok-4.6-high-fast");
  assert.deepEqual(
    current.map((family) => family.label),
    ["Cursor Grok 4.6", "Composer 2.5", "Claude Opus 5", "GPT-5.6 Sol", "GPT-5.6 Terra", "Claude Fable 5.1", "Gemini 3.8 Flash", "Claude Sonnet 5"],
  );
  assert.deepEqual(
    older.map((family) => family.label),
    ["Claude Opus 4.6", "GPT-5.5", "Claude Fable 5", "Gemini 3.7 Flash", "Claude Sonnet 4.6"],
  );
  assert.equal(familyHint(current[0]!), "High Fast");
  assert.equal(familyHint(families.find((family) => family.key === "composer-2.5")!), "Fast");
  assert.equal(familyHint(families.find((family) => family.key === "claude-opus-5")!), "Max");
});

test("search lists older matches instead of hiding them", () => {
  const families = groupModelFamilies([
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 1M Max Thinking" },
    { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 Thinking" },
  ]);
  const { current, older } = presentFamilies(families, "opus 4");
  assert.deepEqual(
    current.map((family) => family.key),
    ["claude-opus-4-6"],
  );
  assert.deepEqual(older, []);
});
