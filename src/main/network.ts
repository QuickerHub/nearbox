import { networkInterfaces } from "node:os";

export function listPrivateLanAddresses(): string[] {
  const result = new Set<string>();
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.internal || item.family !== "IPv4") {
        continue;
      }
      if (isPrivateLanAddress(item.address)) {
        result.add(item.address);
      }
    }
  }
  return [...result].sort(compareLanAddress);
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
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1" || isPrivateLanAddress(normalizeRemoteIp(value));
}

export function normalizeRemoteIp(ipText: string | undefined): string {
  const value = (ipText ?? "").trim();
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }
  return value;
}

function compareLanAddress(a: string, b: string): number {
  const rank = (ip: string): number => {
    if (ip.startsWith("192.168.")) {
      return 0;
    }
    if (ip.startsWith("10.")) {
      return 1;
    }
    return 2;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}
