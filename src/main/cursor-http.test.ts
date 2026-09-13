import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCursorAgentHttp1, isTransientAgentTransportError, preferHttp1InCliConfig, resetCursorHttp1Ensure } from "./cursor-http.ts";

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

test("ensureCursorAgentHttp1 creates parent dirs when the config path is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "nearbox-cursor-http-"));
  const home = join(root, "home");
  try {
    resetCursorHttp1Ensure();
    const changed = ensureCursorAgentHttp1({ CURSOR_CONFIG_DIR: join(home, "nested", "cursor") }, home);
    assert.equal(changed, true);
    const file = join(home, "nested", "cursor", "cli-config.json");
    assert.equal(existsSync(file), true);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { network?: { useHttp1ForAgent?: boolean } };
    assert.equal(parsed.network?.useHttp1ForAgent, true);
  } finally {
    resetCursorHttp1Ensure();
    rmSync(root, { recursive: true, force: true });
  }
});
