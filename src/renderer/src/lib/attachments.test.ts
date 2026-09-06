import assert from "node:assert/strict";
import test from "node:test";
import { type DraftAttachment, type FileLike, isLikelyImage, stageFiles, stageNotice, titleForFiles } from "./attachments.ts";

function file(name: string, type = "image/png", size = 1000, lastModified = 1): FileLike {
  return { name, type, size, lastModified };
}

const preview = (item: FileLike) => `blob:${item.name}`;

test("images get a preview, other files do not", () => {
  const { next } = stageFiles([], [file("a.png"), file("notes.txt", "text/plain")], 8, preview);
  assert.equal(next.length, 2);
  assert.equal(next[0]!.kind, "image");
  assert.equal(next[0]!.previewUrl, "blob:a.png");
  assert.equal(next[1]!.kind, "file");
  assert.equal(next[1]!.previewUrl, null);
});

test("a pasted screenshot with an empty type is still treated as an image by its name", () => {
  assert.equal(isLikelyImage({ name: "image.png", type: "" }), true);
  assert.equal(isLikelyImage({ name: "report.pdf", type: "application/pdf" }), false);
  assert.equal(isLikelyImage({ name: "blob", type: "image/webp" }), true);
});

test("the same file twice is kept once, and the message stops at the limit", () => {
  const first = stageFiles([], [file("a.png"), file("a.png")], 3, preview);
  assert.equal(first.next.length, 1);
  assert.equal(first.duplicates, 1);
  const second = stageFiles(first.next, [file("b.png"), file("c.png"), file("d.png")], 3, preview);
  assert.deepEqual(
    second.next.map((item) => item.file.name),
    ["a.png", "b.png", "c.png"],
  );
  assert.equal(second.overflow, 1);
  assert.equal(second.added.length, 2);
  // Same name but different bytes is a different file.
  const third = stageFiles(first.next, [file("a.png", "image/png", 2000)], 8, preview);
  assert.equal(third.duplicates, 0);
  assert.equal(third.next.length, 2);
});

test("notices mention what was left out", () => {
  assert.equal(stageNotice({ duplicates: 0, overflow: 0 }, 8), null);
  assert.match(stageNotice({ duplicates: 0, overflow: 2 }, 8)!, /最多带 8 个文件.*2 个/);
  assert.match(stageNotice({ duplicates: 1, overflow: 0 }, 8)!, /已经在附件里/);
});

test("staged items keep distinct keys", () => {
  const { next } = stageFiles([] as DraftAttachment<FileLike>[], [file("a.png"), file("b.png")], 8, preview);
  assert.notEqual(next[0]!.key, next[1]!.key);
});

test("a task recorded from pictures alone gets a sensible title", () => {
  assert.equal(titleForFiles([{ name: "shot.png", mediaType: "image/png" }]), "shot.png");
  assert.equal(
    titleForFiles([
      { name: "a.png", mediaType: "image/png" },
      { name: "b.jpg", mediaType: "image/jpeg" },
    ]),
    "2 张图片",
  );
  assert.equal(
    titleForFiles([
      { name: "a.png", mediaType: "image/png" },
      { name: "log.txt", mediaType: "text/plain" },
    ]),
    "2 个文件",
  );
});
