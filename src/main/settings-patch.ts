/**
 * Which HostSettings fields a paired phone may change. Desktop-only knobs
 * (remote control, login item, CLI paths) stay off the LAN API for phones so a
 * modified client cannot widen privilege.
 *
 * Runtime-import free of `@shared` so `node --test` can cover the edges.
 */

export type SettingsActorRole = "desktop" | "phone";

export type AgentSettingPatch = {
  access?: "safe" | "full";
  model?: string;
  command?: string;
};

export type SettingsPatch = {
  maxConcurrentRuns?: number;
  closeToTray?: boolean;
  launchAtLogin?: boolean;
  notifyOnRunFinish?: boolean;
  remoteControlEnabled?: boolean;
  preferredHost?: string;
  agents?: Partial<Record<string, AgentSettingPatch | undefined>>;
};

/** Merge one agent row so a partial PATCH cannot wipe `command` / access / model. */
export function mergeAgentSetting(
  prev: AgentSettingPatch | undefined,
  next: AgentSettingPatch,
): { access: "safe" | "full"; model?: string; command?: string } {
  const base = prev ?? { access: "safe" as const };
  const access = next.access === "full" || next.access === "safe" ? next.access : base.access === "full" ? "full" : "safe";
  return {
    access,
    model: "model" in next ? next.model || undefined : base.model,
    command: "command" in next ? String(next.command ?? "").trim() || undefined : base.command,
  };
}

/**
 * Strip desktop-only fields for phone sessions. Phones may still change default
 * access/model and maxConcurrentRuns (composer + settings UI); not remote
 * control, tray/login, notifications, or CLI command overrides.
 */
export function restrictSettingsPatch(role: SettingsActorRole, patch: SettingsPatch): SettingsPatch {
  if (role === "desktop") {
    return patch;
  }
  const out: SettingsPatch = {};
  if (patch.maxConcurrentRuns !== undefined) {
    out.maxConcurrentRuns = patch.maxConcurrentRuns;
  }
  if (patch.agents) {
    const agents: NonNullable<SettingsPatch["agents"]> = {};
    for (const [kind, row] of Object.entries(patch.agents)) {
      if (!row) {
        continue;
      }
      // command omitted — phone cannot point the host at another binary
      const cleaned: AgentSettingPatch = {};
      if (row.access === "full" || row.access === "safe") {
        cleaned.access = row.access;
      }
      if (row.model !== undefined) {
        cleaned.model = row.model;
      }
      if (Object.keys(cleaned).length > 0) {
        agents[kind] = cleaned;
      }
    }
    if (Object.keys(agents).length > 0) {
      out.agents = agents;
    }
  }
  return out;
}
