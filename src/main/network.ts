import { networkInterfaces } from "node:os";

/** Adapter names that are almost never the network a phone is on. */
const VIRTUAL_ADAPTER = /vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|wsl|docker|tap-|tun|tailscale|zerotier|loopback|bluetooth|npcap|vpn|openvpn|wireguard|hamachi|radmin/i;

export function listPrivateLanAddresses(): string[] {
  const ranked: { address: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const [name, items] of Object.entries(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.internal || item.family !== "IPv4") {
        continue;
      }
      if (isPrivateLanAddress(item.address) && !seen.has(item.address)) {
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
  // 192.168.x.x home routers first, then 10.x corporate, then 172.16/12.
  if (address.startsWith("192.168.")) {
    rank += 0;
  } else if (address.startsWith("10.")) {
    rank += 1;
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
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "::ffff:127.0.0.1" ||
    isPrivateLanAddress(normalizeRemoteIp(value))
  );
}

export function normalizeRemoteIp(ipText: string | undefined): string {
  const value = (ipText ?? "").trim();
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }
  return value;
}
