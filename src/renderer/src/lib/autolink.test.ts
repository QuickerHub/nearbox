import assert from "node:assert/strict";
import test from "node:test";
import { peelAutolink, safeHttpUrl, splitInline } from "./autolink.ts";

test("only http(s) urls become links", () => {
  assert.equal(safeHttpUrl("https://localhost:3000/"), "https://localhost:3000/");
  assert.equal(safeHttpUrl("http://127.0.0.1:5173"), "http://127.0.0.1:5173/");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("file:///etc/passwd"), null);
});

test("trailing punctuation is not part of a bare url", () => {
  assert.deepEqual(peelAutolink("https://example.com."), { href: "https://example.com", trail: "." });
  assert.deepEqual(peelAutolink("https://example.com/path)."), { href: "https://example.com/path", trail: ")." });
  assert.deepEqual(peelAutolink("https://example.com/a(b)"), { href: "https://example.com/a(b)", trail: "" });
});

test("bare urls and markdown links are split out; code stays literal", () => {
  const pieces = splitInline("打开 http://localhost:3000 或 [文档](https://example.com)，还有 `https://not-a-link`。");
  assert.deepEqual(pieces, [
    { type: "text", text: "打开 " },
    { type: "link", href: "http://localhost:3000/", text: "http://localhost:3000" },
    { type: "text", text: " 或 " },
    { type: "link", href: "https://example.com/", text: "文档" },
    { type: "text", text: "，还有 " },
    { type: "code", text: "https://not-a-link" },
    { type: "text", text: "。" },
  ]);
});

test("a url wrapped in bold is still a url once the bold is opened", () => {
  assert.deepEqual(splitInline("启动后一般会在 **http://localhost:5173** 打开。"), [
    { type: "text", text: "启动后一般会在 " },
    { type: "bold", text: "http://localhost:5173" },
    { type: "text", text: " 打开。" },
  ]);
  assert.deepEqual(splitInline("http://localhost:5173"), [
    { type: "link", href: "http://localhost:5173/", text: "http://localhost:5173" },
  ]);
});

test("angle-bracket autolinks work and javascript hrefs stay text", () => {
  assert.deepEqual(splitInline("见 <https://example.com/a>"), [
    { type: "text", text: "见 " },
    { type: "link", href: "https://example.com/a", text: "https://example.com/a" },
  ]);
  assert.ok(splitInline("[x](javascript:alert(1))").every((piece) => piece.type !== "link"));
});

test("markdown links keep balanced parentheses and ignore titles", () => {
  assert.deepEqual(splitInline("[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) more"), [
    { type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", text: "wiki" },
    { type: "text", text: " more" },
  ]);
  assert.deepEqual(splitInline('see [docs](https://example.com/a "My Docs") please'), [
    { type: "text", text: "see " },
    { type: "link", href: "https://example.com/a", text: "docs" },
    { type: "text", text: " please" },
  ]);
  assert.deepEqual(splitInline("[x](<https://example.com/path>)"), [
    { type: "link", href: "https://example.com/path", text: "x" },
  ]);
});
