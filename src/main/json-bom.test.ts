import assert from "node:assert/strict";
import test from "node:test";
import { stripBom } from "./json-bom.ts";

test("stripBom removes a leading UTF-8 BOM and leaves plain text alone", () => {
  assert.equal(stripBom("\uFEFF{\"a\":1}"), "{\"a\":1}");
  assert.equal(stripBom("{\"a\":1}"), "{\"a\":1}");
  assert.equal(stripBom(""), "");
});
