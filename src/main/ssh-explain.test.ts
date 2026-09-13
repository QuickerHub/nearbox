import assert from "node:assert/strict";
import test from "node:test";
import { adoptProbeIdentity, isSshUser } from "./ssh-explain.ts";

test("isSshUser rejects option-like and control-laden names", () => {
  assert.equal(isSshUser("alice"), true);
  assert.equal(isSshUser("a.b-c_1"), true);
  assert.equal(isSshUser(""), false);
  assert.equal(isSshUser("-oProxyCommand=evil"), false);
  assert.equal(isSshUser("a b"), false);
  assert.equal(isSshUser("bob\nroot"), false);
  assert.equal(isSshUser("x".repeat(129)), false);
});

test("adoptProbeIdentity drops a bad user and rejects a control-char home", () => {
  assert.deepEqual(adoptProbeIdentity("alice", "C:\\Users\\alice"), { user: "alice", home: "C:\\Users\\alice" });
  assert.deepEqual(adoptProbeIdentity("-lroot", "/home/alice"), { user: "", home: "/home/alice" });
  assert.deepEqual(adoptProbeIdentity("alice", ""), { user: "alice", home: "" });
  assert.throws(() => adoptProbeIdentity("alice", "/home/alice\n/etc"), /路径不合法/);
});
