import assert from "node:assert/strict";
import test from "node:test";
import {
  depthKey,
  EFFORT_LEVELS,
  familyMatchesIdeId,
  findFamily,
  groupModelFamilies,
  idePrefForFamily,
  parseEffort,
} from "./model-variants.ts";

test("parseEffort accepts catalog levels and maps extra-high aliases to xhigh", () => {
  assert.equal(parseEffort(undefined), undefined);
  assert.equal(parseEffort(""), undefined);
  assert.equal(parseEffort("bogus"), undefined);
  assert.equal(parseEffort("HIGH"), "high");
  assert.equal(parseEffort("extra-high"), "xhigh");
  assert.equal(parseEffort("extra_high"), "xhigh");
  assert.equal(parseEffort("Extra High"), "xhigh");
  for (const level of EFFORT_LEVELS) {
    assert.equal(parseEffort(level), level);
  }
});

test("depthKey collapses effort depths to the effort token", () => {
  assert.equal(depthKey({ kind: "default" }), "default");
  assert.equal(depthKey({ kind: "thinking" }), "thinking");
  assert.equal(depthKey({ kind: "effort", effort: "max" }), "max");
  assert.equal(depthKey({ kind: "effort", effort: "xhigh" }), "xhigh");
});

test("findFamily matches a variant id or a bare alias id", () => {
  const families = groupModelFamilies([
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 Max" },
    { id: "claude-opus-5-thinking-high-fast", label: "Claude Opus 5 High Fast" },
    { id: "gpt-5.5-high", label: "GPT-5.5 High" },
    { id: "auto", label: "Auto" },
  ]);
  assert.equal(findFamily(families, "")?.key, undefined);
  assert.equal(findFamily(families, "missing")?.key, undefined);
  assert.equal(findFamily(families, "claude-opus-5-thinking-max")?.key, "claude-opus-5");
  assert.equal(findFamily(families, "gpt-5.5-high")?.key, "gpt-5.5");
  // Alias without a suffix still resolves to the family that owns that base.
  assert.equal(findFamily(families, "claude-opus-5")?.key, "claude-opus-5");
  assert.equal(findFamily(families, "auto")?.key, "auto");
});

test("familyMatchesIdeId and idePrefForFamily follow Cursor IDE ids", () => {
  const families = groupModelFamilies([
    { id: "auto", label: "Auto" },
    { id: "cursor-grok-4.6-high-fast", label: "Cursor Grok 4.6 High Fast" },
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 Max" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
  ]);
  const auto = families.find((family) => family.key === "auto")!;
  const grok = families.find((family) => family.key === "cursor-grok-4.6")!;
  const opus = families.find((family) => family.key === "claude-opus-5")!;
  const composer = families.find((family) => family.key === "composer-2.5")!;

  assert.equal(familyMatchesIdeId(auto, "default"), true);
  assert.equal(familyMatchesIdeId(auto, "Auto"), true);
  assert.equal(familyMatchesIdeId(grok, "grok-4.6"), true);
  assert.equal(familyMatchesIdeId(grok, "cursor-grok-4.6"), true);
  assert.equal(familyMatchesIdeId(opus, "claude-opus-5"), true);
  assert.equal(familyMatchesIdeId(opus, "gpt-5.5"), false);
  assert.equal(familyMatchesIdeId(composer, "composer-2.5"), true);

  const prefs = [
    { id: "default", visible: true, label: "Auto" },
    { id: "grok-4.6", visible: true, label: "Cursor Grok 4.6" },
    { id: "claude-opus-5", visible: false, label: "Claude Opus 5" },
  ];
  assert.equal(idePrefForFamily(auto, prefs)?.id, "default");
  assert.equal(idePrefForFamily(grok, prefs)?.visible, true);
  assert.equal(idePrefForFamily(opus, prefs)?.visible, false);
  assert.equal(idePrefForFamily(composer, prefs), undefined);
  assert.equal(idePrefForFamily(opus, undefined), undefined);
  assert.equal(idePrefForFamily(opus, []), undefined);
});
