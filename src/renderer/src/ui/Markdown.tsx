import { Fragment, memo, type MouseEvent, type ReactNode, useMemo } from "react";
import { splitInline } from "../lib/autolink";
import { parseBlocks, splitStreamingMarkdown, type MdAlign, type MdBlock } from "../lib/markdown";

/**
 * Tiny markdown renderer for agent summaries: headings, lists, tables, fenced
 * code, quotes, inline code, bold and links. The stored text is never rewritten;
 * React escapes everything, so nothing here can inject markup.
 *
 * When `streaming` is set, completed block boundaries stay in a sealed Markdown
 * tree and only the open tail remounts on each delta. The sealed tree is
 * `memo`ised on the sealed string so unchanged prefixes skip React work.
 */
export function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }): JSX.Element {
  const parts = useMemo(() => (streaming ? splitStreamingMarkdown(text) : null), [streaming, text]);
  if (parts) {
    return (
      <div className={["md", className].filter(Boolean).join(" ")}>
        {parts.sealed ? <SealedMarkdown text={parts.sealed} /> : null}
        {parts.tail ? <p className="md__stream-tail">{parts.tail}</p> : null}
      </div>
    );
  }
  return (
    <div className={["md", className].filter(Boolean).join(" ")}>
      <SealedMarkdown text={text} />
    </div>
  );
}

/** Parsed once per distinct sealed prefix; skipped on token deltas that only grow the tail. */
const SealedMarkdown = memo(function SealedMarkdown({ text }: { text: string }): JSX.Element {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </>
  );
});

function renderBlock(block: MdBlock): ReactNode {
  switch (block.type) {
    case "code":
      return (
        <pre className="md__code" data-lang={block.lang || undefined}>
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
    case "table":
      return (
        <div className="md__table-wrap">
          <table className="md__table">
            <thead>
              <tr>
                {block.headers.map((cell, index) => (
                  <th key={index} className={alignClass(block.aligns[index])}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className={alignClass(block.aligns[index])}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote className="md__quote">
          {block.blocks.map((inner, index) => (
            <Fragment key={index}>{renderBlock(inner)}</Fragment>
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="md__hr" />;
    case "para":
      return <p>{renderInline(block.text)}</p>;
  }
}

function alignClass(align: MdAlign | undefined): string | undefined {
  return align && align !== "left" ? `md__cell--${align}` : undefined;
}

function renderInline(text: string): ReactNode[] {
  return splitInline(text).map((piece, key) => {
    switch (piece.type) {
      case "code":
        return <code key={key}>{piece.text}</code>;
      case "bold":
        return <strong key={key}>{renderInline(piece.text)}</strong>;
      case "link":
        return (
          <a key={key} className="md__link" href={piece.href} target="_blank" rel="noreferrer noopener" onClick={(event) => openHref(event, piece.href)}>
            {renderInline(piece.text)}
          </a>
        );
      default:
        return <Fragment key={key}>{piece.text}</Fragment>;
    }
  });
}

function openHref(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  event.preventDefault();
  if (window.nearboxDesktop) {
    void window.nearboxDesktop.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
