import assert from "node:assert/strict";
import test from "node:test";
import { attachmentSection, buildDelegatedPrompt, buildTurnPrompt, delegationSection, imagePaths, type PromptAttachment } from "./prompt.ts";

const shot: PromptAttachment = { name: "shot.png", path: "D:\\inbox\\phone\\shot.png", mediaType: "image/png" };
const log: PromptAttachment = { name: "app.log", path: "D:\\inbox\\phone\\app.log", mediaType: "text/plain" };

test("a text-only turn is passed through untouched apart from trimming", () => {
  assert.equal(buildTurnPrompt("  修一下登录页\r\n按钮错位  ", [], false), "修一下登录页\n按钮错位");
  assert.doesNotMatch(buildTurnPrompt("你好", [], false), /# 任务：|## 要求/);
});

test("a turn with files keeps the words first and lists every file with its kind", () => {
  const prompt = buildTurnPrompt("按钮错位，看截图", [shot, log], false);
  assert.equal(
    prompt,
    ["按钮错位，看截图", "", "## 附件（本机路径，可直接读取）", "- 图片：D:\\inbox\\phone\\shot.png", "- 文件：D:\\inbox\\phone\\app.log"].join("\n"),
  );
});

test("an image sent without words still gives the agent something to act on", () => {
  const prompt = buildTurnPrompt("", [shot], false);
  assert.match(prompt, /^请查看以下附件。\n/);
  assert.match(prompt, /- 图片：D:\\inbox\\phone\\shot\.png$/);
});

test("remote runs say the files were copied over", () => {
  const lines = attachmentSection([shot], true);
  assert.equal(lines[0], "## 附件（已复制到这台电脑上，可直接读取）");
  assert.equal(lines.at(-1), "");
  assert.deepEqual(attachmentSection([], true), []);
});

test("imagePaths picks only images, in order", () => {
  assert.deepEqual(imagePaths([log, shot, { ...shot, name: "b.jpg", path: "/tmp/b.jpg", mediaType: "image/jpeg" }]), [
    "D:\\inbox\\phone\\shot.png",
    "/tmp/b.jpg",
  ]);
});

test("the delegation section names every target and shows the command with a real agent", () => {
  const lines = delegationSection(
    [
      { kind: "grok", label: "Grok Build" },
      { kind: "claude", label: "Claude Code" },
    ],
    90,
  );
  assert.equal(lines[0], "## 可以委派给其他 Agent");
  assert.match(lines[1]!, /Grok Build（grok）、Claude Code（claude）/);
  assert.ok(lines.some((line) => line.startsWith("    nearbox ask grok ")));
  assert.ok(lines.some((line) => line.startsWith("    nearbox ask claude --file")));
  assert.ok(lines.some((line) => line.includes("90 秒")));
  assert.equal(lines.at(-1), "");
  assert.deepEqual(delegationSection([], 90), []);
});

test("a delegated prompt says who is asking and where to work; follow-ups carry only the words", () => {
  const project = { name: "nearbox", path: "D:\\source\\nearbox" };
  const first = buildDelegatedPrompt("  把接口补上测试\r\n跑通  ", "Cursor Agent", project, false);
  assert.match(first, /^把接口补上测试\n跑通\n\n## 说明\n- 这个任务由 Cursor Agent 委派给你/);
  assert.match(first, /项目「nearbox」（D:\\source\\nearbox）/);
  assert.equal(buildDelegatedPrompt("再检查一遍", "Cursor Agent", project, true), "再检查一遍");
});
