import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureCursorAgentHttp1,
  isTransientAgentTransportError,
  preferHttp1InCliConfig,
  resetCursorHttp1Ensure,
} from "./cursor-http.ts";

test("the HTTP/2 keepalive drop cursor-agent reports is treated as transient", () => {
  assert.equal(
    isTransientAgentTransportError("Error: RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms"),
    true,
  );
  assert.equal(isTransientAgentTransportError("RetriableError: [unavailable] PING timed out"), true);
  assert.equal(isTransientAgentTransportError("HTTP/2 keepalive ping timed out after 5000ms"), true);
  assert.equal(isTransientAgentTransportError("Agent 提前结束（end_turn）"), false);
  assert.equal(isTransientAgentTransportError("ENOENT: no such file"), false);
});

test("preferHttp1InCliConfig only writes when the flag is missing or false", () => {
  assert.deepEqual(preferHttp1InCliConfig({ network: { useHttp1ForAgent: true } }), {
    next: { network: { useHttp1ForAgent: true } },
    changed: false,
  });
  assert.deepEqual(preferHttp1InCliConfig({ network: { useHttp1ForAgent: false }, model: "composer-2.5" }), {
    next: { network: { useHttp1ForAgent: true }, model: "composer-2.5" },
    changed: true,
  });
  assert.deepEqual(preferHttp1InCliConfig({}), {
    next: { network: { useHttp1ForAgent: true } },
    changed: true,
  });
  assert.deepEqual(preferHttp1InCliConfig(null), {
    next: { network: { useHttp1ForAgent: true } },
    changed: true,
  });
});

test("ensureCursorAgentHttp1 writes HTTP/1.1 once and is idempotent until reset", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-http-"));
  const configDir = join(root, "cursor");
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, "cli-config.json");
  writeFileSync(file, JSON.stringify({ model: "composer-2.5", network: { useHttp1ForAgent: false } }, null, 2), "utf8");
  try {
    resetCursorHttp1Ensure();
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: configDir }, root), true);
    const first = JSON.parse(readFileSync(file, "utf8")) as { model?: string; network?: { useHttp1ForAgent?: boolean } };
    assert.equal(first.model, "composer-2.5");
    assert.equal(first.network?.useHttp1ForAgent, true);

    // Second call in the same process must not touch the file again.
    writeFileSync(file, JSON.stringify({ model: "other" }, null, 2), "utf8");
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: configDir }, root), false);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).model, "other");

    resetCursorHttp1Ensure();
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: configDir }, root), true);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).network?.useHttp1ForAgent, true);
  } finally {
    resetCursorHttp1Ensure();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureCursorAgentHttp1 creates cli-config.json when missing and no-ops when already HTTP/1.1", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-http-miss-"));
  const configDir = join(root, "cursor");
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, "cli-config.json");
  try {
    resetCursorHttp1Ensure();
    assert.equal(existsSync(file), false);
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: configDir }, root), true);
    assert.equal(existsSync(file), true);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).network?.useHttp1ForAgent, true);

    resetCursorHttp1Ensure();
    assert.equal(ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: configDir }, root), false);
  } finally {
    resetCursorHttp1Ensure();
    rmSync(root, { recursive: true, force: true });
  }
});
