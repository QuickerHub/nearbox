import assert from "node:assert/strict";
import test from "node:test";
import { attachmentSection, buildTurnPrompt, imagePaths, type PromptAttachment } from "./prompt.ts";

const shot: PromptAttachment = { name: "shot.png", path: "D:\\inbox\\phone\\shot.png", mediaType: "image/png" };
const log: PromptAttachment = { name: "app.log", path: "D:\\inbox\\phone\\app.log", mediaType: "text/plain" };

test("a text-only turn is passed through untouched apart from trimming", () => {
  assert.equal(buildTurnPrompt("  修一下登录页\r\n按钮错位  ", [], false), "修一下登录页\n按钮错位");
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
