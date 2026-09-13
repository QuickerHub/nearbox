import assert from "node:assert/strict";
import test from "node:test";
import { adoptDetectedAgents } from "./agent-detect.ts";

type Row = {
  kind: string;
  label: string;
  available: boolean;
  command?: string;
  detail?: string;
  supportsResume: boolean;
  models?: string[];
  modelsCheckedAt?: string;
};

function row(kind: string, patch: Partial<Row> = {}): Row {
  return { kind, label: kind, available: true, supportsResume: true, ...patch };
}

test("adoptDetectedAgents reuses the previous array when detection is unchanged", () => {
  const previous = [row("cursor", { models: ["auto"], modelsCheckedAt: "t0" }), row("grok", { available: false, detail: "missing" })];
  const detected = [row("cursor"), row("grok", { available: false, detail: "missing" })];
  const next = adoptDetectedAgents(previous, detected);
  assert.equal(next, previous);
  assert.equal(next[0]?.models?.[0], "auto");
});

test("adoptDetectedAgents keeps prior object when only that agent is unchanged", () => {
  const previous = [row("cursor", { models: ["auto"] }), row("grok", { available: false, detail: "missing" })];
  const detected = [row("cursor"), row("grok", { available: true, command: "grok" })];
  const next = adoptDetectedAgents(previous, detected);
  assert.notEqual(next, previous);
  assert.equal(next[0], previous[0]);
  assert.equal(next[1]?.available, true);
  assert.equal(next[1]?.command, "grok");
});

test("adoptDetectedAgents carries models onto a replaced detection row", () => {
  const previous = [row("cursor", { command: "old", models: ["auto"], modelsCheckedAt: "t0" })];
  const detected = [row("cursor", { command: "new" })];
  const next = adoptDetectedAgents(previous, detected);
  assert.equal(next[0]?.command, "new");
  assert.deepEqual(next[0]?.models, ["auto"]);
  assert.equal(next[0]?.modelsCheckedAt, "t0");
});

test("adoptDetectedAgents returns a fresh empty array for empty detection", () => {
  const previous = [row("cursor")];
  const next = adoptDetectedAgents(previous, []);
  assert.deepEqual(next, []);
  assert.notEqual(next, previous);
});

test("adoptDetectedAgents rebuilds when kind order changes", () => {
  const previous = [row("cursor"), row("grok")];
  const detected = [row("grok"), row("cursor")];
  const next = adoptDetectedAgents(previous, detected);
  assert.notEqual(next, previous);
  assert.deepEqual(
    next.map((item) => item.kind),
    ["grok", "cursor"],
  );
});
