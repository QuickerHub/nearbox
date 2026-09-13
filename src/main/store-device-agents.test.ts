import assert from "node:assert/strict";
import test from "node:test";
import { coerceDevicePort, sanitizeDeviceAgents } from "./store-device-agents.ts";

test("sanitizeDeviceAgents keeps one row per known kind", () => {
  assert.deepEqual(sanitizeDeviceAgents(null), []);
  assert.deepEqual(sanitizeDeviceAgents("x"), []);
  const rows = sanitizeDeviceAgents([
    null,
    { kind: "cursor", label: " Cursor ", available: true, supportsResume: 1 },
    { kind: "cursor", label: "dup", available: false, supportsResume: false },
    { kind: "nope", label: "x", available: true, supportsResume: false },
    { kind: "codex", label: "", available: false, supportsResume: true },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.kind, "cursor");
  assert.equal(rows[0]!.label, "Cursor");
  assert.equal(rows[0]!.available, true);
  assert.equal(rows[0]!.supportsResume, false);
  assert.equal(rows[1]!.kind, "codex");
  assert.equal(rows[1]!.label, "codex");
});

test("coerceDevicePort keeps integer TCP ports only", () => {
  assert.equal(coerceDevicePort(22), 22);
  assert.equal(coerceDevicePort(1), 1);
  assert.equal(coerceDevicePort(65535), 65535);
  assert.equal(coerceDevicePort(0), undefined);
  assert.equal(coerceDevicePort(22.5), undefined);
  assert.equal(coerceDevicePort(Number.NaN), undefined);
  assert.equal(coerceDevicePort("22"), undefined);
  assert.equal(coerceDevicePort(70000), undefined);
});
