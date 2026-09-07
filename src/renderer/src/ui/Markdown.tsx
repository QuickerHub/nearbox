import { Fragment, type MouseEvent, type ReactNode } from "react";
import { splitInline } from "../lib/autolink";
import { parseBlocks, type MdAlign, type MdBlock } from "../lib/markdown";

/**
 * Tiny markdown renderer for agent summaries: headings, lists, tables, fenced
 * code, quotes, inline code, bold and links. The stored text is never rewritten;
 * React escapes everything, so nothing here can inject markup.
 */
export function Markdown({ text, className }: { text: string; className?: string }): JSX.Element {
  const blocks = parseBlocks(text);
  return (
    <div className={["md", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

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
            {piece.text}
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
