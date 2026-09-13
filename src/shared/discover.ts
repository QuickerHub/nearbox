export const DISCOVERY_PORT = 17832;
export const DISCOVERY_SERVICE = "nearbox";
const DEFAULT_PORT = 17831;
const PROTOCOL_VERSION = 1;

export interface DiscoverInfo {
  service: typeof DISCOVERY_SERVICE;
  protocolVersion: number;
  name: string;
  host: string;
  port: number;
  version: string;
  pin?: string;
  token?: string;
  url?: string;
}

export function buildDiscoverInfo(input: {
  name: string;
  host: string;
  port?: number;
  version: string;
  pin?: string;
  token?: string;
  url?: string;
}): DiscoverInfo {
  return {
    service: DISCOVERY_SERVICE,
    protocolVersion: PROTOCOL_VERSION,
    name: input.name,
    host: input.host,
    port: input.port ?? DEFAULT_PORT,
    version: input.version,
    pin: input.pin,
    token: input.token,
    url: input.url,
  };
}

/**
 * True when an invite's expiresAt is at or before `now`. Used by the host
 * snapshot and Android-facing discover so a dead PIN is never advertised.
 */
export function isInviteExpired(expiresAt: string, now = Date.now()): boolean {
  const at = Date.parse(expiresAt);
  return !Number.isFinite(at) || at <= now;
}

/** Return `invite` only while it is still usable; otherwise null. */
export function liveInvite<T extends { expiresAt: string }>(invite: T | null | undefined, now = Date.now()): T | null {
  if (!invite || isInviteExpired(invite.expiresAt, now)) {
    return null;
  }
  return invite;
}

export function parseDiscover(raw: unknown): DiscoverInfo | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.service !== DISCOVERY_SERVICE) {
    return null;
  }
  // Host may answer { service, error } when it has no LAN address yet; that is not a pairable host.
  if (typeof value.error === "string" && value.error.trim()) {
    return null;
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const port = Number(value.port ?? DEFAULT_PORT);
  const version = typeof value.version === "string" ? value.version : "";
  if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return {
    service: DISCOVERY_SERVICE,
    protocolVersion: Number(value.protocolVersion ?? PROTOCOL_VERSION),
    name,
    host,
    port,
    version,
    pin: typeof value.pin === "string" ? value.pin : undefined,
    token: typeof value.token === "string" ? value.token : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
  };
}

export function parseInviteText(text: string): { host: string; port: number; token: string } | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    const token = url.searchParams.get("t") || url.searchParams.get("token") || url.searchParams.get("pin") || "";
    if (url.protocol === "nearbox:" && url.hostname === "connect") {
      const host = url.searchParams.get("host")?.trim() ?? "";
      const port = Number(url.searchParams.get("port") ?? DEFAULT_PORT);
      if (host && token) {
        return { host, port: Number.isInteger(port) ? port : DEFAULT_PORT, token };
      }
      return null;
    }
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname && token) {
      return { host: url.hostname, port: url.port ? Number(url.port) : DEFAULT_PORT, token };
    }
  } catch {
    return null;
  }
  return null;
}
