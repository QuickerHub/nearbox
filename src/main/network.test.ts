import assert from "node:assert/strict";
import test from "node:test";
import { isAdvertisableLanAddress, isCgnatAddress, isIpv4Family, isLoopbackOrPrivate, isPrivateLanAddress, isTransientSocketError, normalizeRemoteIp, refreshPrivateLanAddresses, sameStringList } from "./network.ts";

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

test("CGNAT / Tailscale addresses are advertisable and trusted like LAN", () => {
  assert.equal(isCgnatAddress("100.64.0.1"), true);
  assert.equal(isCgnatAddress("100.127.255.254"), true);
  assert.equal(isCgnatAddress("100.63.0.1"), false);
  assert.equal(isCgnatAddress("100.128.0.1"), false);
  assert.equal(isPrivateLanAddress("100.64.0.1"), false);
  assert.equal(isAdvertisableLanAddress("100.118.245.42"), true);
  assert.equal(isAdvertisableLanAddress("192.168.1.8"), true);
  assert.equal(isLoopbackOrPrivate("100.118.245.42"), true);
  assert.equal(isLoopbackOrPrivate("::ffff:100.64.1.2"), true);
});

test("IPv4 family accepts string or number", () => {
  assert.equal(isIpv4Family("IPv4"), true);
  assert.equal(isIpv4Family(4), true);
  assert.equal(isIpv4Family("IPv6"), false);
  assert.equal(isIpv4Family(6), false);
});
