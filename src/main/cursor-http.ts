import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// cursor-agent talks to the model over HTTP/2 with a 5 s keepalive ping. A
// long turn (thinking, tools, a slow hop) that does not answer the ping in
// time dies with RetriableError. Official workaround is HTTP/1.1, which the
// CLI reads from ~/.cursor/cli-config.json as network.useHttp1ForAgent.

/** How many times one warm turn retries after a keepalive drop. */
export const KEEPALIVE_RETRIES = 2;

/** Follow-up sent when the original prompt already produced some work. */
export const KEEPALIVE_CONTINUE_PROMPT = "刚才因连接中断没有写完。请从中断处继续，不要重复已经完成的步骤。";

export function isTransientAgentTransportError(text: string): boolean {
  if (/keepalive ping timed out/i.test(text)) {
    return true;
  }
  if (/HTTP\/2 keepalive/i.test(text)) {
    return true;
  }
  return /RetriableError/i.test(text) && /PING timed out/i.test(text);
}

/** Same directory cursor-agent uses for cli-config.json. */
export function cursorCliConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.CURSOR_CONFIG_DIR?.trim();
  if (override) {
    return join(override, "cli-config.json");
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return join(xdg ? join(xdg, "cursor") : join(home, ".cursor"), "cli-config.json");
}

/**
 * Fold `network.useHttp1ForAgent: true` into a cli-config object. Pure so the
 * write side can be tested without touching the user's file.
 */
export function preferHttp1InCliConfig(raw: unknown): { next: Record<string, unknown>; changed: boolean } {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const network =
    config.network && typeof config.network === "object" && !Array.isArray(config.network)
      ? { ...(config.network as Record<string, unknown>) }
      : {};
  if (network.useHttp1ForAgent === true) {
    return { next: config, changed: false };
  }
  network.useHttp1ForAgent = true;
  config.network = network;
  return { next: config, changed: true };
}

let ensured = false;

/**
 * Make sure the next cursor-agent process uses HTTP/1.1. Returns true when
 * the file was just flipped, so a host started under HTTP/2 should be recycled.
 */
export function ensureCursorAgentHttp1(env: NodeJS.ProcessEnv = process.env, home = homedir()): boolean {
  if (ensured) {
    return false;
  }
  const path = cursorCliConfigPath(env, home);
  try {
    let raw: unknown = {};
    if (existsSync(path)) {
      raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    }
    const { next, changed } = preferHttp1InCliConfig(raw);
    if (changed) {
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
    ensured = true;
    return changed;
  } catch (error) {
    console.warn(`[cursor-http] 无法把 cursor-agent 切到 HTTP/1.1：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Exposed for tests that write the config more than once. */
export function resetCursorHttp1Ensure(): void {
  ensured = false;
}
