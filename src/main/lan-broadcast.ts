/**
 * UDP discovery targets. A single 255.255.255.255 pulse often misses a second
 * adapter on multi-homed Windows hosts; directed subnet broadcasts cover each.
 */

import { networkInterfaces } from "node:os";
import { isPrivateLanAddress } from "./network.ts";

/** Adapter names that are almost never the network a phone is on. */
const VIRTUAL_ADAPTER =
  /vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|wsl|docker|tap-|tun|tailscale|zerotier|loopback|bluetooth|npcap|vpn|openvpn|wireguard|hamachi|radmin/i;

export function ipv4Broadcast(address: string, netmask: string): string | null {
  const addr = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (addr === null || mask === null) {
    return null;
  }
  return intToIpv4((addr & mask) | (~mask >>> 0));
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

/**
 * Global broadcast plus one directed broadcast per physical private IPv4
 * adapter. Deduped; always includes `255.255.255.255` first.
 */
export function listDiscoveryBroadcastTargets(
  interfaces: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const targets = new Set<string>(["255.255.255.255"]);
  for (const [name, items] of Object.entries(interfaces)) {
    if (VIRTUAL_ADAPTER.test(name)) {
      continue;
    }
    for (const item of items ?? []) {
      if (item.internal || item.family !== "IPv4" || !isPrivateLanAddress(item.address)) {
        continue;
      }
      const broadcast = ipv4Broadcast(item.address, item.netmask || "255.255.255.0");
      if (broadcast) {
        targets.add(broadcast);
      }
    }
  }
  return [...targets];
}
