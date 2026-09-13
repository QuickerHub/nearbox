import assert from "node:assert/strict";
import test from "node:test";
import {
  dayKey,
  formatBytes,
  formatDay,
  formatDuration,
  formatRelative,
  formatTime,
  sameDay,
} from "./format.ts";

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

test("formatTime and dayKey reject empty or invalid values", () => {
  assert.equal(formatTime(undefined), "");
  assert.equal(formatTime("not-a-date"), "");
  assert.equal(dayKey(undefined), "");
  assert.equal(dayKey("bogus"), "");
  const iso = "2026-09-13T12:34:00.000Z";
  assert.match(formatTime(iso), /\d{2}:\d{2}/);
  assert.match(dayKey(iso), /^2026-\d+-\d+$/);
});

test("formatDay labels today and yesterday in Chinese", () => {
  const now = new Date();
  assert.equal(formatDay(now.toISOString()), "今天");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  assert.equal(formatDay(yesterday.toISOString()), "昨天");
  assert.equal(formatDay(undefined), "");
  assert.equal(sameDay(now, now), true);
  assert.equal(sameDay(now, yesterday), false);
});

test("formatDuration without end uses wall clock and stays non-empty", () => {
  const started = new Date(Date.now() - 2_000).toISOString();
  assert.match(formatDuration(started, undefined), /\d+ 秒/);
});
