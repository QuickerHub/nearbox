import assert from "node:assert/strict";
import test from "node:test";
import { adoptSessionTitle, splitCapture } from "./titles.ts";

test("the first line of a capture becomes the title, clamped", () => {
  assert.equal(splitCapture("修一下登录").title, "修一下登录");
  assert.equal(splitCapture("标题\n\n后面的细节").title, "标题");
  assert.equal(splitCapture("标题\n\n后面的细节").details, "后面的细节");
  const long = "字".repeat(200);
  assert.equal(splitCapture(long).title, `${"字".repeat(117)}…`);
  assert.equal(splitCapture(long).details, long);
});

test("an agent session title replaces a long dump, not a short name", () => {
  const dump = "clip/main , 用户反馈，删除过后的返回期能不能自定义，我感觉实际问题可能是清空触发后的这段时间无法收集新的 item";
  assert.equal(adoptSessionTitle(dump, "自定义删除反悔时间"), "自定义删除反悔时间");
  assert.equal(adoptSessionTitle(`${"字".repeat(117)}…`, "短标题"), "短标题");
  // Already a usable name (typed or previously adopted).
  assert.equal(adoptSessionTitle("修一下登录", "Fix login"), null);
  assert.equal(adoptSessionTitle("自定义删除反悔时间", "自定义删除反悔时间"), null);
  assert.equal(adoptSessionTitle(dump, "   "), null);
});

test("splitCapture trims, collapses whitespace, and keeps short one-liners detail-free", () => {
  assert.deepEqual(splitCapture("\n\n正文第一行\n其余"), { title: "正文第一行", details: "其余" });
  assert.equal(splitCapture("").title, "");
  assert.equal(splitCapture("   ").title, "");
  assert.equal(splitCapture("一行标题").details, "");
  assert.equal(splitCapture("  多   空格\n细节 ").title, "多 空格");
  assert.equal(splitCapture("  多   空格\n细节 ").details, "细节");
});

test("adoptSessionTitle keeps short current names even when incoming is longer", () => {
  assert.equal(adoptSessionTitle("短名", "一个更长的会话标题"), null);
  assert.equal(adoptSessionTitle("x".repeat(41), "新标题"), "新标题");
  assert.equal(adoptSessionTitle("已截断的标题…", "更好的标题"), "更好的标题");
});
