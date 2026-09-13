import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackOrPrivate, isPrivateLanAddress, isTransientSocketError, normalizeRemoteIp, refreshPrivateLanAddresses, sameStringList } from "./network.ts";

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

test("mapped IPv4 unwrap is case-insensitive", () => {
  assert.equal(normalizeRemoteIp("::FFFF:10.0.0.2"), "10.0.0.2");
});

test("loopback is the whole 127/8, including IPv4-mapped", () => {
  assert.equal(isLoopbackOrPrivate("127.0.0.1"), true);
  assert.equal(isLoopbackOrPrivate("127.0.1.1"), true);
  assert.equal(isLoopbackOrPrivate("::1"), true);
  assert.equal(isLoopbackOrPrivate("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackOrPrivate("::FFFF:127.1.2.3"), true);
  assert.equal(isLoopbackOrPrivate("192.168.1.8"), true);
  assert.equal(isLoopbackOrPrivate("8.8.8.8"), false);
});
