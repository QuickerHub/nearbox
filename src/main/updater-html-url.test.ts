import assert from "node:assert/strict";
import test from "node:test";
import { coerceReleaseNotes, resolveReleaseHtmlUrl } from "./updater-html-url.ts";

const FALLBACK = "https://github.com/QuickerHub/nearbox/releases/latest";

test("resolveReleaseHtmlUrl rejects blank and non-string values", () => {
  assert.equal(resolveReleaseHtmlUrl(undefined, FALLBACK), FALLBACK);
  assert.equal(resolveReleaseHtmlUrl(null, FALLBACK), FALLBACK);
  assert.equal(resolveReleaseHtmlUrl("", FALLBACK), FALLBACK);
  assert.equal(resolveReleaseHtmlUrl("   ", FALLBACK), FALLBACK);
  assert.equal(resolveReleaseHtmlUrl(12, FALLBACK), FALLBACK);
  assert.equal(
    resolveReleaseHtmlUrl(" https://github.com/QuickerHub/nearbox/releases/tag/v1 ", FALLBACK),
    "https://github.com/QuickerHub/nearbox/releases/tag/v1",
  );
});

test("coerceReleaseNotes tolerates non-string bodies and caps length", () => {
  assert.equal(coerceReleaseNotes(undefined), "");
  assert.equal(coerceReleaseNotes({ text: "x" }), "");
  assert.equal(coerceReleaseNotes("  hello  "), "hello");
  assert.equal(coerceReleaseNotes("x".repeat(500)).length, 400);
});
