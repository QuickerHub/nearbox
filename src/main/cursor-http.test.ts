import assert from "node:assert/strict";
import test from "node:test";
import { KEEPALIVE_CONTINUE_PROMPT, KEEPALIVE_RETRIES, cursorCliConfigPath, isTransientAgentTransportError, preferHttp1InCliConfig } from "./cursor-http.ts";

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

test("cursorCliConfigPath honors CURSOR_CONFIG_DIR and XDG_CONFIG_HOME", () => {
  assert.match(
    cursorCliConfigPath({ CURSOR_CONFIG_DIR: "/custom/cursor" }, "/home/cea").replaceAll("\\", "/"),
    /\/custom\/cursor\/cli-config\.json$/,
  );
  assert.match(
    cursorCliConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/cea").replaceAll("\\", "/"),
    /\/xdg\/cursor\/cli-config\.json$/,
  );
  assert.match(
    cursorCliConfigPath({}, "/home/cea").replaceAll("\\", "/"),
    /\/home\/cea\/\.cursor\/cli-config\.json$/,
  );
});

test("keepalive retry budget and continue prompt stay pinned", () => {
  assert.equal(KEEPALIVE_RETRIES, 2);
  assert.match(KEEPALIVE_CONTINUE_PROMPT, /从中断处继续/);
});
