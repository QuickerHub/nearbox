import assert from "node:assert/strict";
import test from "node:test";
import { ipv4Broadcast, listDiscoveryBroadcastTargets } from "./lan-broadcast.ts";

test("ipv4Broadcast derives the subnet broadcast address", () => {
  assert.equal(ipv4Broadcast("192.168.1.8", "255.255.255.0"), "192.168.1.255");
  assert.equal(ipv4Broadcast("10.0.5.10", "255.255.0.0"), "10.0.255.255");
  assert.equal(ipv4Broadcast("not-an-ip", "255.255.255.0"), null);
});

test("listDiscoveryBroadcastTargets always includes global broadcast and directed ones", () => {
  const targets = listDiscoveryBroadcastTargets({
    eth0: [
      {
        address: "192.168.1.8",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.8/24",
      },
    ],
    "vEthernet (WSL)": [
      {
        address: "172.22.0.1",
        netmask: "255.255.240.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "172.22.0.1/20",
      },
    ],
  });
  assert.equal(targets[0], "255.255.255.255");
  assert.ok(targets.includes("192.168.1.255"));
  assert.ok(!targets.includes("172.22.15.255"), "virtual adapters are skipped");
});
