import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFilesMap } from "./store-files.ts";

test("normalizeFilesMap drops arrays, nulls, and rows missing path or name", () => {
  assert.deepEqual(normalizeFilesMap(null), {});
  assert.deepEqual(normalizeFilesMap([]), {});
  assert.deepEqual(
    normalizeFilesMap({
      ok: { path: "/tmp/a.png", name: "a.png", mediaType: "image/png", byteLength: 12 },
      bad: { path: "/tmp/x", name: "" },
      noPath: { name: "x" },
      nested: null,
    }),
    { ok: { path: "/tmp/a.png", name: "a.png", mediaType: "image/png", byteLength: 12 } },
  );
});

test("normalizeFilesMap fills a default mediaType and ignores bad byteLength", () => {
  assert.deepEqual(normalizeFilesMap({ a: { path: "/a", name: "a", byteLength: -1 } }), {
    a: { path: "/a", name: "a", mediaType: "application/octet-stream" },
  });
});
