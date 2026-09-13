import assert from "node:assert/strict";
import test from "node:test";
import { isCgnatAddress, isNearbySshConfigHost, isPrivateLanAddress, isTransientSocketError, normalizeRemoteIp, refreshPrivateLanAddresses, sameStringList } from "./network.ts";

test("only RFC1918 addresses count as LAN", () => {
  assert.equal(isPrivateLanAddress("192.168.1.8"), true);
  assert.equal(isPrivateLanAddress("10.0.0.2"), true);
  assert.equal(isPrivateLanAddress("172.16.0.1"), true);
  assert.equal(isPrivateLanAddress("8.8.8.8"), false);
  assert.equal(isPrivateLanAddress("127.0.0.1"), false);
});

test("mapped IPv4 is unwrapped", () => {
  assert.equal(normalizeRemoteIp("::ffff:192.168.1.8"), "192.168.1.8");
});

test("dropped TCP connections are treated as transient", () => {
  assert.equal(isTransientSocketError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isTransientSocketError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), true);
  assert.equal(isTransientSocketError(new Error("read ECONNRESET")), true);
  assert.equal(isTransientSocketError(new Error("ENOENT: no such file")), false);
  assert.equal(isTransientSocketError(new Error("Cannot read properties of undefined")), false);
});

test("sameStringList compares order and length", () => {
  assert.equal(sameStringList(["a", "b"], ["a", "b"]), true);
  assert.equal(sameStringList(["a", "b"], ["b", "a"]), false);
  assert.equal(sameStringList(["a"], ["a", "b"]), false);
});

test("refreshPrivateLanAddresses reuses previous when unchanged", () => {
  const first = refreshPrivateLanAddresses(null);
  const again = refreshPrivateLanAddresses(first);
  assert.equal(again, first);
});

test("normalizeRemoteIp passes through empty, undefined, and non-mapped values", () => {
  assert.equal(normalizeRemoteIp(undefined), "");
  assert.equal(normalizeRemoteIp(""), "");
  assert.equal(normalizeRemoteIp("  "), "");
  assert.equal(normalizeRemoteIp("10.0.0.2"), "10.0.0.2");
  assert.equal(normalizeRemoteIp("::1"), "::1");
});

test("isCgnatAddress accepts the 100.64/10 Tailscale range only", () => {
  assert.equal(isCgnatAddress("100.64.0.1"), true);
  assert.equal(isCgnatAddress("100.100.1.2"), true);
  assert.equal(isCgnatAddress("100.127.255.254"), true);
  assert.equal(isCgnatAddress("100.63.0.1"), false);
  assert.equal(isCgnatAddress("100.128.0.1"), false);
  assert.equal(isCgnatAddress("10.0.0.1"), false);
  assert.equal(isCgnatAddress("100.64"), false);
  assert.equal(isCgnatAddress(""), false);
});

test("isNearbySshConfigHost keeps LAN/CGNAT IPs and short or .local/.lan names", () => {
  assert.equal(isNearbySshConfigHost({ hostName: "192.168.1.20" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "10.0.0.2" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "172.16.0.1" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "100.64.1.5" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "laptop" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "dev.local" }), true);
  assert.equal(isNearbySshConfigHost({ hostName: "box.lan" }), true);
});

test("isNearbySshConfigHost drops proxied hosts, public IPs, and public DNS names", () => {
  assert.equal(isNearbySshConfigHost({ hostName: "192.168.1.20", proxied: true }), false);
  assert.equal(isNearbySshConfigHost({ hostName: "8.8.8.8" }), false);
  assert.equal(isNearbySshConfigHost({ hostName: "github.com" }), false);
  assert.equal(isNearbySshConfigHost({ hostName: "bastion.example.com" }), false);
  assert.equal(isNearbySshConfigHost({ hostName: "100.63.0.1" }), false);
});
