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

test("isLoopbackOrPrivate covers loopback and mapped LAN", () => {
  assert.equal(isLoopbackOrPrivate("127.0.0.1"), true);
  assert.equal(isLoopbackOrPrivate("::1"), true);
  assert.equal(isLoopbackOrPrivate("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackOrPrivate("::ffff:192.168.1.8"), true);
  assert.equal(isLoopbackOrPrivate("8.8.8.8"), false);
  assert.equal(isLoopbackOrPrivate(undefined), false);
});

test("isPrivateLanAddress rejects malformed and public ranges", () => {
  assert.equal(isPrivateLanAddress("172.15.0.1"), false);
  assert.equal(isPrivateLanAddress("172.32.0.1"), false);
  assert.equal(isPrivateLanAddress("192.168.1"), false);
  assert.equal(isPrivateLanAddress("192.168.1.256"), false);
  assert.equal(isPrivateLanAddress("not-an-ip"), false);
  assert.equal(isPrivateLanAddress("172.31.255.255"), true);
});

test("isTransientSocketError accepts code-only transport failures", () => {
  assert.equal(isTransientSocketError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" })), true);
  assert.equal(isTransientSocketError(Object.assign(new Error("boom"), { code: "EHOSTUNREACH" })), true);
  assert.equal(isTransientSocketError(Object.assign(new Error("boom"), { code: "ENETUNREACH" })), true);
  assert.equal(isTransientSocketError(Object.assign(new Error("boom"), { code: "ERR_STREAM_DESTROYED" })), true);
  assert.equal(isTransientSocketError(null), false);
  assert.equal(isTransientSocketError("ECONNRESET"), false);
});
