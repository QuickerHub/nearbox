import assert from "node:assert/strict";
import test from "node:test";
import {
  remoteStatusFieldsMatch,
  remoteStatusSignature,
  reuseRemoteStatus,
} from "./remote-status.ts";

const base = { supported: true, enabled: true, controllers: 0, display: { width: 1920, height: 1080 } };

test("remoteStatusSignature covers supported/enabled/controllers/display", () => {
  assert.equal(remoteStatusSignature(base), "1|1|0|1920x1080");
  assert.equal(remoteStatusSignature({ ...base, enabled: false, controllers: 2, display: null }), "1|0|2|");
});

test("reuseRemoteStatus keeps identity when unchanged", () => {
  const first = { ...base };
  const again = reuseRemoteStatus(first, { ...base });
  assert.equal(again, first);
  const bumped = reuseRemoteStatus(first, { ...base, controllers: 1 });
  assert.notEqual(bumped, first);
  assert.equal(bumped.controllers, 1);
});

test("remoteStatusFieldsMatch skips display lookup when core fields match", () => {
  assert.equal(remoteStatusFieldsMatch(base, true, true, 0), true);
  assert.equal(remoteStatusFieldsMatch(base, true, true, 1), false);
  assert.equal(remoteStatusFieldsMatch(null, true, true, 0), false);
});

test("reuseRemoteStatus adopts next when cache is missing", () => {
  const next = { ...base, controllers: 4 };
  assert.equal(reuseRemoteStatus(undefined, next), next);
  assert.equal(reuseRemoteStatus(null, next), next);
  const cached = { ...base, display: { width: 1280, height: 720 } };
  const changedDisplay = { ...base, display: { width: 1920, height: 1080 } };
  assert.notEqual(reuseRemoteStatus(cached, changedDisplay), cached);
  assert.equal(remoteStatusSignature(changedDisplay), "1|1|0|1920x1080");
});
