import type { AgentKind, AgentSettings, HostSettings } from "../shared/protocol.ts";
import { normalizeModelId } from "../shared/models.ts";

/** Keep aligned with `AGENT_KINDS` / `DEFAULT_SETTINGS` in protocol (load-path only). */
const AGENT_KINDS: AgentKind[] = ["cursor", "codex", "grok", "claude", "opencode"];

const DEFAULT_SETTINGS: HostSettings = {
  maxConcurrentRuns: 1,
  closeToTray: true,
  launchAtLogin: false,
  notifyOnRunFinish: true,
  remoteControlEnabled: true,
  agents: {},
};

/**
 * Clamp / coerce settings the same way as updateSettings so a hand-edited or
 * partially written state.json cannot unlock unbounded concurrency or leave
 * non-booleans in tray/login toggles.
 */
export function normalizeSettings(raw: unknown): HostSettings {
  const base = DEFAULT_SETTINGS;
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<HostSettings> & Record<string, unknown>) : {};
  const value = Number(src.maxConcurrentRuns);
  const preferred = typeof src.preferredHost === "string" ? src.preferredHost.trim() : "";
  return {
    maxConcurrentRuns: Number.isFinite(value) ? Math.min(4, Math.max(1, Math.round(value))) : base.maxConcurrentRuns,
    closeToTray: src.closeToTray === undefined ? base.closeToTray : Boolean(src.closeToTray),
    launchAtLogin: src.launchAtLogin === undefined ? base.launchAtLogin : Boolean(src.launchAtLogin),
    notifyOnRunFinish: src.notifyOnRunFinish === undefined ? base.notifyOnRunFinish : Boolean(src.notifyOnRunFinish),
    remoteControlEnabled: src.remoteControlEnabled === undefined ? base.remoteControlEnabled : Boolean(src.remoteControlEnabled),
    preferredHost: preferred || undefined,
    agents: normalizeAgentSettings(src.agents),
  };
}

function normalizeAgentSettings(value: unknown): Partial<Record<AgentKind, AgentSettings>> {
  const out: Partial<Record<AgentKind, AgentSettings>> = {};
  if (!value || typeof value !== "object") {
    return out;
  }
  for (const kind of AGENT_KINDS) {
    const next = (value as Record<string, unknown>)[kind];
    if (!next || typeof next !== "object") {
      continue;
    }
    const record = next as Record<string, unknown>;
    out[kind] = {
      access: record.access === "full" ? "full" : "safe",
      model: normalizeModelId(record.model),
      command: typeof record.command === "string" && record.command.trim() ? record.command.trim() : undefined,
    };
  }
  return out;
}
