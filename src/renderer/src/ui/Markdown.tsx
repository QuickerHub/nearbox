import { Fragment, type ReactNode } from "react";

/**
 * Tiny markdown renderer for agent summaries: headings, bullet/numbered lists,
 * fenced code, inline code and bold. Everything else is plain text; React
 * escapes it, so nothing here can inject markup.
 */
export function Markdown({ text, className }: { text: string; className?: string }): JSX.Element {
  const blocks = parseBlocks(text.replace(/\r\n/g, "\n"));
  return (
    <div className={["md", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

type Block =
  | { type: "code"; lang: string; body: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "para"; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", lang, body: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2] ?? "" });
      index += 1;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const para: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^```/.test(lines[index] ?? "") &&
      !/^(#{1,6})\s+/.test(lines[index] ?? "") &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[index] ?? "")
    ) {
      para.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "para", text: para.join("\n") });
  }
  return blocks;
}

function renderBlock(block: Block): ReactNode {
  switch (block.type) {
    case "code":
      return (
        <pre className="md__code">
          <code>{block.body}</code>
        </pre>
      );
    case "heading": {
      const Tag = (`h${Math.min(6, block.level + 2)}` as unknown) as "h3";
      return <Tag className="md__heading">{renderInline(block.text)}</Tag>;
    }
    case "list":
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "para":
      return <p>{renderInline(block.text)}</p>;
  }
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}
