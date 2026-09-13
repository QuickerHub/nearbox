import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscoverInfo, isInviteExpired, liveInvite, parseDiscover, parseInviteText } from "./discover.ts";

test("discover payload round-trips", () => {
  const info = buildDiscoverInfo({
    name: "LAPTOP",
    host: "192.168.1.8",
    version: "0.3.0",
    pin: "123456",
    token: "abc",
    url: "http://192.168.1.8:17831/?t=abc",
  });
  const parsed = parseDiscover(JSON.parse(JSON.stringify(info)));
  assert.equal(parsed?.name, "LAPTOP");
  assert.equal(parsed?.pin, "123456");
  assert.equal(parsed?.token, "abc");
});

test("invite URLs from QR and deep link parse", () => {
  assert.deepEqual(parseInviteText("http://192.168.1.8:17831/?t=tok"), {
    host: "192.168.1.8",
    port: 17831,
    token: "tok",
  });
  assert.deepEqual(parseInviteText("nearbox://connect?host=10.0.2.2&port=17831&t=pin6"), {
    host: "10.0.2.2",
    port: 17831,
    token: "pin6",
  });
  assert.equal(parseInviteText("http://example.com/"), null);
});

test("error discover payloads are not hosts", () => {
  assert.equal(parseDiscover({ service: "nearbox", error: "电脑还没有局域网地址" }), null);
});

test("liveInvite hides expired credentials", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");
  assert.equal(isInviteExpired("2026-09-13T11:59:59.000Z", now), true);
  assert.equal(isInviteExpired("2026-09-13T12:00:00.000Z", now), true);
  assert.equal(isInviteExpired("2026-09-13T12:00:01.000Z", now), false);
  assert.equal(isInviteExpired("not-a-date", now), true);
  const invite = { pin: "123456", expiresAt: "2026-09-13T12:00:01.000Z" };
  assert.equal(liveInvite(invite, now)?.pin, "123456");
  assert.equal(liveInvite({ ...invite, expiresAt: "2026-09-13T11:00:00.000Z" }, now), null);
  assert.equal(liveInvite(null, now), null);
});
