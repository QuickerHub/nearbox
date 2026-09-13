import assert from "node:assert/strict";
import test from "node:test";
import { capCatalogModels, trimCatalogString } from "./store-catalog-trim.ts";

test("trimCatalogString trims, bounds, and drops blanks", () => {
  assert.equal(trimCatalogString("  gpt-5  "), "gpt-5");
  assert.equal(trimCatalogString("   "), undefined);
  assert.equal(trimCatalogString(1), undefined);
  assert.equal(trimCatalogString("x".repeat(300))?.length, 256);
});

test("capCatalogModels keeps the head and tolerates bad max", () => {
  assert.deepEqual(capCatalogModels([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(capCatalogModels([1, 2, 3], 0), []);
  assert.deepEqual(capCatalogModels([1, 2], 10), [1, 2]);
});
