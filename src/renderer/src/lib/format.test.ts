import assert from "node:assert/strict";
import test from "node:test";
import { dayKey, formatBytes, formatDuration, formatRelative, formatTime, sameDay } from "./format.ts";

test("formatDuration uses Chinese units and rejects bad dates", () => {
  assert.equal(formatDuration(undefined, undefined), "");
  assert.equal(formatDuration("not-a-date", "2026-09-13T12:00:00.000Z"), "");
  assert.equal(formatDuration("2026-09-13T12:00:00.000Z", "2026-09-13T12:00:45.000Z"), "45 秒");
  assert.equal(formatDuration("2026-09-13T12:00:00.000Z", "2026-09-13T12:03:05.000Z"), "3 分 5 秒");
  assert.equal(formatDuration("2026-09-13T10:00:00.000Z", "2026-09-13T12:15:00.000Z"), "2 小时 15 分");
});

test("formatBytes scales", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("formatRelative covers near and far", () => {
  const now = Date.now();
  assert.equal(formatRelative(new Date(now - 10_000).toISOString()), "刚刚");
  assert.equal(formatRelative(new Date(now - 5 * 60_000).toISOString()), "5 分钟前");
  assert.equal(formatRelative(undefined), "");
  assert.equal(formatRelative("bogus"), "");
});

test("formatTime and dayKey reject empty or invalid stamps", () => {
  assert.equal(formatTime(undefined), "");
  assert.equal(formatTime("bogus"), "");
  assert.equal(dayKey(undefined), "");
  assert.equal(dayKey("bogus"), "");
  const stamp = "2026-09-13T15:04:00.000Z";
  assert.ok(formatTime(stamp).length > 0);
  assert.match(dayKey(stamp), /^2026-\d+-\d+$/);
});

test("sameDay compares calendar fields only", () => {
  const localA = new Date(2026, 8, 13, 1, 0, 0);
  const localB = new Date(2026, 8, 13, 23, 0, 0);
  const localC = new Date(2026, 8, 14, 1, 0, 0);
  assert.equal(sameDay(localA, localB), true);
  assert.equal(sameDay(localA, localC), false);
});
