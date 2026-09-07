import assert from "node:assert/strict";
import test from "node:test";
import { parseCursorIdeModels } from "./cursor-ide-models.ts";
import { groupModelFamilies, presentFamilies } from "./model-variants.ts";

test("Cursor IDE toggles: defaultOn plus user overrides", () => {
  const prefs = parseCursorIdeModels({
    availableDefaultModels2: [
      { name: "default", defaultOn: true, clientDisplayName: "Auto" },
      { name: "grok-4.6", defaultOn: true, clientDisplayName: "Cursor Grok 4.6" },
      { name: "claude-opus-5", defaultOn: true, clientDisplayName: "Claude Opus 5" },
      { name: "claude-opus-4-8", defaultOn: false, clientDisplayName: "Claude Opus 4.8" },
      { name: "gpt-5.5", defaultOn: false, clientDisplayName: "GPT-5.5" },
      { name: "claude-fable-5", defaultOn: false, clientDisplayName: "Claude Fable 5" },
      { name: "gemini-3.7-flash", defaultOn: false, clientDisplayName: "Gemini 3.7 Flash" },
    ],
    aiSettings: {
      modelOverrideEnabled: ["claude-fable-5", "gemini-3.7-flash"],
      modelOverrideDisabled: [],
    },
  });
  assert.deepEqual(
    prefs?.map((item) => [item.id, item.visible, item.label]),
    [
      ["default", true, "Auto"],
      ["grok-4.6", true, "Cursor Grok 4.6"],
      ["claude-opus-5", true, "Claude Opus 5"],
      ["claude-opus-4-8", false, "Claude Opus 4.8"],
      ["gpt-5.5", false, "GPT-5.5"],
      ["claude-fable-5", true, "Claude Fable 5"],
      ["gemini-3.7-flash", true, "Gemini 3.7 Flash"],
    ],
  );
});

test("a disabled override hides a default-on model", () => {
  const prefs = parseCursorIdeModels({
    availableDefaultModels2: [{ name: "claude-opus-5", defaultOn: true, clientDisplayName: "Claude Opus 5" }],
    aiSettings: { modelOverrideDisabled: ["claude-opus-5"] },
  });
  assert.equal(prefs?.[0]?.visible, false);
});

test("the picker follows Cursor IDE order and hides toggled-off families", () => {
  const families = groupModelFamilies([
    { id: "auto", label: "Auto" },
    { id: "gpt-5.5-high", label: "GPT-5.5 1M High" },
    { id: "claude-opus-5-thinking-max", label: "Claude Opus 5 Max" },
    { id: "cursor-grok-4.6-high-fast", label: "Cursor Grok 4.6 High Fast" },
    { id: "claude-opus-4-8-thinking", label: "Claude Opus 4.8" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
  ]);
  const prefs = parseCursorIdeModels({
    availableDefaultModels2: [
      { name: "grok-4.6", defaultOn: true, clientDisplayName: "Cursor Grok 4.6" },
      { name: "composer-2.5", defaultOn: true, clientDisplayName: "Composer 2.5" },
      { name: "claude-opus-5", defaultOn: true, clientDisplayName: "Claude Opus 5" },
      { name: "claude-opus-4-8", defaultOn: false, clientDisplayName: "Claude Opus 4.8" },
      { name: "gpt-5.5", defaultOn: false, clientDisplayName: "GPT-5.5" },
    ],
    aiSettings: { modelOverrideEnabled: [], modelOverrideDisabled: [] },
  });
  const { current, older } = presentFamilies(families, "", "", prefs);
  assert.deepEqual(
    current.map((family) => family.key),
    ["cursor-grok-4.6", "composer-2.5", "claude-opus-5"],
  );
  assert.deepEqual(
    older.map((family) => family.key),
    ["claude-opus-4-8", "gpt-5.5"],
  );
});
