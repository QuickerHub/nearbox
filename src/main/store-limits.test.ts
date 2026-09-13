import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CATALOG_MODELS,
  MAX_STATE_JSON_BYTES,
  capCatalogModels,
  isStateJsonTooLarge,
} from "./store-limits.ts";

test("capCatalogModels keeps order and truncates only when over the limit", () => {
  assert.deepEqual(capCatalogModels([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(capCatalogModels([1, 2, 3, 4, 5], 3), [1, 2, 3]);
  assert.equal(capCatalogModels(Array.from({ length: MAX_CATALOG_MODELS + 10 }, (_, i) => i)).length, MAX_CATALOG_MODELS);
});

test("state.json size cap rejects oversize and invalid lengths", () => {
  assert.ok(MAX_STATE_JSON_BYTES >= 1_000_000);
  assert.equal(isStateJsonTooLarge(0), false);
  assert.equal(isStateJsonTooLarge(MAX_STATE_JSON_BYTES), false);
  assert.equal(isStateJsonTooLarge(MAX_STATE_JSON_BYTES + 1), true);
  assert.equal(isStateJsonTooLarge(-1), true);
  assert.equal(isStateJsonTooLarge(Number.NaN), true);
});
