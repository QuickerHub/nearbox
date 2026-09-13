import { networkInterfaces } from "node:os";

/** Adapter names that are almost never the network a phone is on. */
const VIRTUAL_ADAPTER = /vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|wsl|docker|tap-|tun|tailscale|zerotier|loopback|bluetooth|npcap|vpn|openvpn|wireguard|hamachi|radmin/i;

/** Node / Electron may report family as `"IPv4"` or `4`. */
export function isIpv4Family(family: string | number | undefined): boolean {
  return family === "IPv4" || family === 4;
}

/**
 * Tailscale / ZeroTier-style CGNAT (100.64/10). Not RFC1918, but the phone and
 * PC often share only this path when they are not on the same Wi-Fi.
 */
export function isCgnatAddress(ipText: string | undefined): boolean {
  const parts = (ipText ?? "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 100 && b! >= 64 && b! <= 127;
}

/** Addresses we may advertise on the QR / UDP beacon (RFC1918 + CGNAT). */
export function isAdvertisableLanAddress(ipText: string | undefined): boolean {
  return isPrivateLanAddress(ipText) || isCgnatAddress(ipText);
}

export function listPrivateLanAddresses(): string[] {
  const ranked: { address: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const [name, items] of Object.entries(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.internal || !isIpv4Family(item.family)) {
        continue;
      }
      if (isAdvertisableLanAddress(item.address) && !seen.has(item.address)) {
        seen.add(item.address);
        ranked.push({ address: item.address, rank: rankInterface(name, item.address) });
      }
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address)).map((item) => item.address);
}

function rankInterface(name: string, address: string): number {
  let rank = 0;
  if (VIRTUAL_ADAPTER.test(name)) {
    rank += 100;
  }
  // 192.168.x.x home routers first, then 10.x corporate, then 172.16/12, then CGNAT overlays.
  if (address.startsWith("192.168.")) {
    rank += 0;
  } else if (address.startsWith("10.")) {
    rank += 1;
  } else if (isCgnatAddress(address)) {
    rank += 5;
  } else {
    rank += 2;
  }
  // VMware/Hyper-V hand out .1 to the host on their own subnets.
  if (address.endsWith(".1")) {
    rank += 10;
  }
  return rank;
}

export function isPrivateLanAddress(ipText: string | undefined): boolean {
  const parts = (ipText ?? "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isLoopbackOrPrivate(ipText: string | undefined): boolean {
  const value = ipText ?? "";
  if (value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1") {
    return true;
  }
  const normalized = normalizeRemoteIp(value);
  return isPrivateLanAddress(normalized) || isCgnatAddress(normalized);
}

export function normalizeRemoteIp(ipText: string | undefined): string {
  const value = (ipText ?? "").trim();
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }
  return value;
}

const TRANSIENT_SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
]);

/** Peer dropped a TCP connection (phone sleep, Wi-Fi hop, tab close). Not our bug. */
export function isTransientSocketError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_SOCKET_CODES.has(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /^(read |write |connect )?(ECONNRESET|EPIPE|ECONNABORTED)\b/.test(message);
}

/** True when both lists have the same strings in the same order. */
export function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Re-read private LAN addresses, reusing `previous` when the list is unchanged
 * so snapshot ticks do not allocate a fresh hostAddresses array every time.
 */
export function refreshPrivateLanAddresses(previous: readonly string[] | null | undefined): string[] {
  const next = listPrivateLanAddresses();
  if (previous && sameStringList(previous, next)) {
    return previous as string[];
  }
  return next;
}

