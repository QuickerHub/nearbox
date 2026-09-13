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

test("formatSecondsDuration boundaries and rounding", () => {
  assert.equal(formatSecondsDuration(59), "59 秒");
  assert.equal(formatSecondsDuration(60), "1 分 0 秒");
  assert.equal(formatSecondsDuration(61.4), "1 分 1 秒");
  assert.equal(formatSecondsDuration(59.6), "1 分 0 秒");
  assert.equal(formatSecondsDuration(3600), "1 小时 0 分");
  assert.equal(formatSecondsDuration(3600 + 59), "1 小时 0 分");
  assert.equal(formatSecondsDuration(3600 + 60), "1 小时 1 分");
});

test("formatMsDuration crosses the second boundary", () => {
  assert.equal(formatMsDuration(0), "0 毫秒");
  assert.equal(formatMsDuration(999), "999 毫秒");
  assert.equal(formatMsDuration(1000), "1 秒");
  assert.equal(formatMsDuration(59_500), "1 分 0 秒");
});
