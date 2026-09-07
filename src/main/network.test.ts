import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateLanAddress, isTransientSocketError, normalizeRemoteIp } from "./network.ts";

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
