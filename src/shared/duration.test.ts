import assert from "node:assert/strict";
import test from "node:test";
import { formatMsDuration, formatSecondsDuration } from "./duration.ts";

test("formatSecondsDuration uses Chinese units", () => {
  assert.equal(formatSecondsDuration(0), "0 秒");
  assert.equal(formatSecondsDuration(45), "45 秒");
  assert.equal(formatSecondsDuration(185), "3 分 5 秒");
  assert.equal(formatSecondsDuration(2 * 3600 + 15 * 60), "2 小时 15 分");
  assert.equal(formatSecondsDuration(-3), "0 秒");
});

test("formatMsDuration matches CLI result rows", () => {
  assert.equal(formatMsDuration(400), "400 毫秒");
  assert.equal(formatMsDuration(1200), "1 秒");
  assert.equal(formatMsDuration(4835), "5 秒");
  assert.equal(formatMsDuration(125_000), "2 分 5 秒");
  assert.equal(formatMsDuration(3_725_000), "1 小时 2 分");
});
