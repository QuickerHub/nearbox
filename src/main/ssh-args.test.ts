import assert from "node:assert/strict";
import test from "node:test";
import { isSshDestination, isSshIdentityFile, sshArgs } from "./ssh-args.ts";

test("sshArgs puts -- before the destination so dash-hosts are not options", () => {
  const args = sshArgs({ host: "-R2222:127.0.0.1:22", user: "me", port: 2222 }, "true");
  const dest = args.indexOf("--");
  assert.ok(dest >= 0);
  assert.equal(args[dest + 1], "-R2222:127.0.0.1:22");
  assert.equal(args[dest + 2], "true");
  assert.ok(args.indexOf("-R2222:127.0.0.1:22") === dest + 1);
  assert.deepEqual(args.slice(args.indexOf("-p"), dest), ["-p", "2222", "-l", "me"]);
});

test("isSshDestination rejects option-like hosts", () => {
  assert.equal(isSshDestination("192.168.1.8"), true);
  assert.equal(isSshDestination("office.local"), true);
  assert.equal(isSshDestination("fe80::1"), true);
  assert.equal(isSshDestination("-R2222:127.0.0.1:22"), false);
  assert.equal(isSshDestination("-Jevil"), false);
  assert.equal(isSshDestination(""), false);
  assert.equal(isSshDestination("host name"), false);
});

test("isSshIdentityFile rejects dash-options and control chars", () => {
  assert.equal(isSshIdentityFile("/home/me/.ssh/id_ed25519"), true);
  assert.equal(isSshIdentityFile("-oProxyCommand=evil"), false);
  assert.equal(isSshIdentityFile("C:\\keys\\id_rsa"), true);
  assert.equal(isSshIdentityFile("id\nrsa"), false);
  assert.equal(isSshIdentityFile(""), false);
});
