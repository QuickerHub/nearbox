import assert from "node:assert/strict";
import test from "node:test";
import { isGithubRepoSlug, resolveReleaseRepo } from "./updater-repo.ts";

test("isGithubRepoSlug accepts owner/name only", () => {
  assert.equal(isGithubRepoSlug("QuickerHub/nearbox"), true);
  assert.equal(isGithubRepoSlug(" a/b "), true);
  assert.equal(isGithubRepoSlug("QuickerHub/nearbox/extra"), false);
  assert.equal(isGithubRepoSlug("../evil/nearbox"), false);
  assert.equal(isGithubRepoSlug("QuickerHub\\nearbox"), false);
  assert.equal(isGithubRepoSlug(""), false);
  assert.equal(isGithubRepoSlug("only"), false);
});

test("resolveReleaseRepo falls back when the override is unsafe", () => {
  assert.equal(resolveReleaseRepo("QuickerHub/nearbox", "a/b"), "QuickerHub/nearbox");
  assert.equal(resolveReleaseRepo("QuickerHub/nearbox/../x", "a/b"), "a/b");
  assert.equal(resolveReleaseRepo(undefined, "a/b"), "a/b");
});
