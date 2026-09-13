import assert from "node:assert/strict";
import test from "node:test";
import { parseSshConfig, platformFromBanner } from "./lan-discover.ts";

test("parseSshConfig keeps concrete hosts and applies HostName/User/Port/IdentityFile", () => {
  const hosts = parseSshConfig(`
# comment
Host laptop *.skip
  HostName 192.168.1.20
  User cea
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host jump
  HostName bastion.example
  ProxyJump gateway

Host bare
`);
  assert.deepEqual(
    hosts.map((host) => ({
      alias: host.alias,
      hostName: host.hostName,
      user: host.user,
      port: host.port,
      identityFile: host.identityFile,
      proxied: host.proxied,
    })),
    [
      {
        alias: "laptop",
        hostName: "192.168.1.20",
        user: "cea",
        port: 2222,
        identityFile: "~/.ssh/id_ed25519",
        proxied: false,
      },
      {
        alias: "jump",
        hostName: "bastion.example",
        user: undefined,
        port: undefined,
        identityFile: undefined,
        proxied: true,
      },
      {
        alias: "bare",
        hostName: "bare",
        user: undefined,
        port: undefined,
        identityFile: undefined,
        proxied: false,
      },
    ],
  );
});

test("parseSshConfig ignores Match blocks, wildcards, and bad ports", () => {
  const hosts = parseSshConfig(`
Host ok
  Port not-a-number
  Port 0
  Port 70000
  Port 22

Match host elsewhere
  HostName ignored

Host "quoted"
  HostName "dev.local"
`);
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0]?.port, 22);
  assert.equal(hosts[1]?.alias, "quoted");
  assert.equal(hosts[1]?.hostName, "dev.local");
});

test("platformFromBanner maps OpenSSH banners", () => {
  assert.equal(platformFromBanner(undefined), undefined);
  assert.equal(platformFromBanner(""), undefined);
  assert.equal(platformFromBanner("SSH-2.0-OpenSSH_for_Windows_9.5"), "windows");
  assert.equal(platformFromBanner("SSH-2.0-OpenSSH_9.2p1 Ubuntu-1"), "linux");
  assert.equal(platformFromBanner("SSH-2.0-OpenSSH_9.6 FreeBSD-2024"), "linux");
  assert.equal(platformFromBanner("SSH-2.0-OpenSSH_9.6"), undefined);
});
