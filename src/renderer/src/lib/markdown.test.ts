import assert from "node:assert/strict";
import test from "node:test";
import { parseBlocks } from "./markdown.ts";

test("GFM tables and fenced code from a release note", () => {
  const blocks = parseBlocks(`
- 图片组件在端口变化后自动重写 URL 并重试

**发布结果**

| 项目 | 链接/版本 |
|-----|----------|
| GitHub Release | https://github.com/ceastld/CeaQuickerTools/releases/tag/v0.30.39 |
| Quicker 动作 | 剪贴板 n10 已更新到 0.30.39 |

**请你本地操作**

1. 把「剪贴板 n10」更新到 0.30.39
2. 打开动作，确认版本号
3. 如果还是提示端口不对：按 F12 打开控制台，粘贴下面这段后回车：

\`\`\`javascript
sessionStorage.removeItem('intellitools.localApiPort');
location.reload();
\`\`\`
`);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["list", "para", "table", "para", "list", "code"],
  );
  const table = blocks[2];
  assert.equal(table?.type, "table");
  if (table?.type !== "table") {
    return;
  }
  assert.deepEqual(table.headers, ["项目", "链接/版本"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]?.[0], "GitHub Release");
  assert.match(table.rows[0]?.[1] ?? "", /github\.com/);
  const code = blocks[5];
  assert.equal(code?.type, "code");
  if (code?.type !== "code") {
    return;
  }
  assert.equal(code.lang, "javascript");
  assert.equal(code.body, "sessionStorage.removeItem('intellitools.localApiPort');\nlocation.reload();");
});

test("indented fences and tildes still become code blocks", () => {
  const indented = parseBlocks("3. 在控制台运行：\n    ```javascript\n    x()\n    ```");
  assert.deepEqual(
    indented.map((block) => block.type),
    ["list", "code"],
  );
  assert.equal(indented[1]?.type === "code" ? indented[1].lang : "", "javascript");
  assert.equal(indented[1]?.type === "code" ? indented[1].body : "", "    x()");

  const tildes = parseBlocks("~~~\nplain\n~~~");
  assert.deepEqual(tildes, [{ type: "code", lang: "", body: "plain" }]);
});

test("a longer fence can wrap a shorter one", () => {
  const blocks = parseBlocks("````md\n```js\n1\n```\n````");
  assert.deepEqual(blocks, [{ type: "code", lang: "md", body: "```js\n1\n```" }]);
});

test("table alignment and escaped pipes", () => {
  const blocks = parseBlocks("| left | mid | right |\n|:-----|:---:|------:|\n| a \\| b | c | 2 |");
  assert.equal(blocks[0]?.type, "table");
  if (blocks[0]?.type !== "table") {
    return;
  }
  assert.deepEqual(blocks[0].aligns, ["left", "center", "right"]);
  assert.deepEqual(blocks[0].rows[0], ["a | b", "c", "2"]);
});

test("quotes nest and thematic breaks stay out of lists", () => {
  const blocks = parseBlocks("> **note**\n>\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n\n---\n\n- item");
  assert.equal(blocks[0]?.type, "quote");
  if (blocks[0]?.type !== "quote") {
    return;
  }
  assert.deepEqual(
    blocks[0].blocks.map((block) => block.type),
    ["para", "table"],
  );
  assert.deepEqual(
    blocks.slice(1).map((block) => block.type),
    ["hr", "list"],
  );
});
