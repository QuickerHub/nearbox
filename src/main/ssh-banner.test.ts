import assert from "node:assert/strict";
import test from "node:test";
import { appendSshBanner, MAX_SSH_BANNER_BYTES } from "./ssh-banner.ts";

test("appendSshBanner stops at a newline", () => {
  const first = appendSshBanner("", "SSH-2.0-OpenSSH_9.0");
  assert.equal(first.done, false);
  const second = appendSshBanner(first.banner, "\r\nrest-ignored");
  assert.equal(second.done, true);
  assert.equal(second.banner.split("\n")[0]!.trim(), "SSH-2.0-OpenSSH_9.0");
});

test("appendSshBanner caps hostile banners without a newline", () => {
  const flood = "A".repeat(MAX_SSH_BANNER_BYTES * 4);
  const next = appendSshBanner("", flood);
  assert.equal(next.banner.length, MAX_SSH_BANNER_BYTES);
  assert.equal(next.done, true);
  const again = appendSshBanner(next.banner, "more");
  assert.equal(again.banner.length, MAX_SSH_BANNER_BYTES);
  assert.equal(again.done, true);
});
