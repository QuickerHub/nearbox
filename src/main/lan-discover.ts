import { promises as dns } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import type { DeviceCandidate, DevicePlatform } from "@shared/protocol";
import { isPrivateLanAddress } from "./network";

const SSH_PORT = 22;
const CONNECT_TIMEOUT_MS = 700;
const BANNER_TIMEOUT_MS = 1200;
const SCAN_CONCURRENCY = 128;
const MAX_HOSTS_PER_SUBNET = 1024;

/** Names that never point at a computer you would run an agent on. */
const VIRTUAL_ADAPTER = /vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|wsl|docker|tap-|tun|zerotier|loopback|bluetooth|npcap|vpn|openvpn|wireguard|hamachi|radmin/i;

export interface SshConfigHost {
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxied: boolean;
}

/** Parse ~/.ssh/config into concrete (non-wildcard) hosts. */
export function parseSshConfig(text: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = [];
  let current: SshConfigHost[] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const match = /^(\S+)\s*[=\s]\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim().replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((alias) => alias && !/[*?!]/.test(alias))
        .map((alias) => ({ alias, hostName: alias, proxied: false }));
      hosts.push(...current);
      continue;
    }
    if (key === "match") {
      current = null;
      continue;
    }
    if (!current) {
      continue;
    }
    for (const host of current) {
      switch (key) {
        case "hostname":
          host.hostName = value;
          break;
        case "user":
          host.user = value;
          break;
        case "port": {
          const port = Number(value);
          host.port = Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
          break;
        }
        case "identityfile":
          host.identityFile = value;
          break;
        case "proxyjump":
        case "proxycommand":
          host.proxied = true;
          break;
      }
    }
  }
  return hosts;
}

export function readSshConfigHosts(): SshConfigHost[] {
  const file = join(homedir(), ".ssh", "config");
  if (!existsSync(file)) {
    return [];
  }
  try {
    return parseSshConfig(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** Tailscale and friends hand out 100.64.0.0/10; those are reachable like a LAN. */
function isCgnatAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

/** Hosts from ~/.ssh/config that plausibly sit on the local network. */
export function nearbySshConfigHosts(): SshConfigHost[] {
  return readSshConfigHosts().filter((host) => {
    if (host.proxied) {
      return false;
    }
    const name = host.hostName;
    if (isIpv4(name)) {
      return isPrivateLanAddress(name) || isCgnatAddress(name);
    }
    return !name.includes(".") || name.endsWith(".local") || name.endsWith(".lan");
  });
}

export interface PortProbe {
  reachable: boolean;
  banner?: string;
}

/** Connect to host:port and read the SSH identification line if one arrives. */
export function probeSshPort(host: string, port = SSH_PORT): Promise<PortProbe> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let banner = "";
    const finish = (result: PortProbe) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };
    const connectTimer = setTimeout(() => finish({ reachable: false }), CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      setTimeout(() => finish({ reachable: true, banner: banner.trim() || undefined }), BANNER_TIMEOUT_MS);
    });
    socket.on("data", (chunk: Buffer) => {
      banner += chunk.toString("latin1");
      if (banner.includes("\n")) {
        finish({ reachable: true, banner: banner.split("\n")[0]!.trim() });
      }
    });
    socket.once("error", () => {
      clearTimeout(connectTimer);
      finish({ reachable: false });
    });
    socket.connect(port, host);
  });
}

export function platformFromBanner(banner: string | undefined): DevicePlatform | undefined {
  if (!banner) {
    return undefined;
  }
  if (/OpenSSH_for_Windows|Windows/i.test(banner)) {
    return "windows";
  }
  if (/Ubuntu|Debian|Raspbian|FreeBSD|Linux/i.test(banner)) {
    return "linux";
  }
  return undefined;
}

interface Subnet {
  addresses: string[];
  self: string;
}

/** IPv4 ranges of the physical adapters, each capped so a /16 does not turn into a 65k-host sweep. */
function localSubnets(): Subnet[] {
  const subnets: Subnet[] = [];
  for (const [name, items] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(name)) {
      continue;
    }
    for (const item of items ?? []) {
      if (item.internal || item.family !== "IPv4" || !isPrivateLanAddress(item.address)) {
        continue;
      }
      const self = ipToInt(item.address);
      let mask = ipToInt(item.netmask || "255.255.255.0");
      let hosts = ~mask >>> 0;
      if (hosts > MAX_HOSTS_PER_SUBNET) {
        mask = ipToInt("255.255.255.0");
        hosts = 255;
      }
      const network = (self & mask) >>> 0;
      const addresses: string[] = [];
      for (let offset = 1; offset < hosts; offset += 1) {
        const address = (network + offset) >>> 0;
        if (address !== self) {
          addresses.push(intToIp(address));
        }
      }
      if (addresses.length) {
        subnets.push({ addresses, self: item.address });
      }
    }
  }
  return subnets;
}

function ipToInt(address: string): number {
  return address.split(".").reduce((acc, part) => ((acc << 8) + (Number(part) & 255)) >>> 0, 0);
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

async function reverseName(address: string): Promise<string | undefined> {
  const lookup = dns.reverse(address).then((names) => names[0]).catch(() => undefined);
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 800));
  const name = await Promise.race([lookup, timeout]);
  return name ? name.replace(/\.$/, "") : undefined;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Every address on the local subnets with something answering on port 22. */
export async function scanLanForSsh(): Promise<DeviceCandidate[]> {
  const subnets = localSubnets();
  const addresses = [...new Set(subnets.flatMap((subnet) => subnet.addresses))];
  const probes = await mapLimit(addresses, SCAN_CONCURRENCY, async (address) => ({ address, probe: await probeSshPort(address) }));
  const reachable = probes.filter((item) => item.probe.reachable);
  return Promise.all(
    reachable.map(async ({ address, probe }) => ({
      host: address,
      address,
      label: await reverseName(address),
      platform: platformFromBanner(probe.banner),
      source: "lan-scan" as const,
      reachable: true,
    })),
  );
}

/**
 * ssh config aliases that look local, each checked for a listening sshd so the
 * user sees straight away which ones are switched on.
 */
export async function sshConfigCandidates(): Promise<DeviceCandidate[]> {
  const hosts = nearbySshConfigHosts();
  return Promise.all(
    hosts.map(async (host) => {
      const probe = await probeSshPort(host.hostName, host.port ?? SSH_PORT);
      return {
        host: host.alias,
        address: host.hostName !== host.alias ? host.hostName : undefined,
        user: host.user,
        port: host.port,
        platform: platformFromBanner(probe.banner),
        source: "ssh-config" as const,
        reachable: probe.reachable,
      };
    }),
  );
}

/** Config aliases first, then whatever the sweep found that no alias already covers. */
export async function discoverDevices(): Promise<DeviceCandidate[]> {
  const [fromConfig, fromScan] = await Promise.all([sshConfigCandidates(), scanLanForSsh()]);
  const known = new Set(fromConfig.map((item) => item.address ?? item.host));
  const merged = [...fromConfig, ...fromScan.filter((item) => !known.has(item.address ?? item.host))];
  return merged.sort((a, b) => Number(Boolean(b.reachable)) - Number(Boolean(a.reachable)) || a.host.localeCompare(b.host));
}
