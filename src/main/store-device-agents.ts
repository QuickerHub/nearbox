/**
 * Bound and sanitize agents[] on a persisted remote device. Free of `@shared`
 * so node --test can import this file directly.
 */

export const DEVICE_AGENT_KINDS = ["cursor", "codex", "grok", "claude", "opencode"] as const;
export type DeviceAgentKind = (typeof DEVICE_AGENT_KINDS)[number];

export interface DeviceAgentInfo {
  kind: DeviceAgentKind;
  label: string;
  available: boolean;
  supportsResume: boolean;
  command?: string;
  detail?: string;
}

const KIND_SET: ReadonlySet<string> = new Set(DEVICE_AGENT_KINDS);

/** Keep at most one row per known agent kind; drop unknown kinds / non-objects. */
export function sanitizeDeviceAgents(value: unknown): DeviceAgentInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<DeviceAgentKind>();
  const out: DeviceAgentInfo[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.kind !== "string" || !KIND_SET.has(row.kind) || seen.has(row.kind as DeviceAgentKind)) {
      continue;
    }
    const kind = row.kind as DeviceAgentKind;
    seen.add(kind);
    const next: DeviceAgentInfo = {
      kind,
      label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : kind,
      available: row.available === true,
      supportsResume: row.supportsResume === true,
    };
    if (typeof row.command === "string" && row.command) {
      next.command = row.command;
    }
    if (typeof row.detail === "string" && row.detail) {
      next.detail = row.detail;
    }
    out.push(next);
    if (out.length >= DEVICE_AGENT_KINDS.length) {
      break;
    }
  }
  return out;
}

/** Keep only a real TCP port; NaN / floats / out-of-range become undefined. */
export function coerceDevicePort(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    return undefined;
  }
  return value;
}
