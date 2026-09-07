/**
     * Split inline markdown into text / code / bold / links. Used only to paint
     * the conversation; the stored agent output is never rewritten.
     */

    export type InlinePiece =
      | { type: "text"; text: string }
      | { type: "code"; text: string }
      | { type: "bold"; text: string }
      | { type: "link"; href: string; text: string };

    const TOKEN =
      /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>"'`]+)/g;

    const MARKDOWN_LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
    const ANGLE_LINK = /^<(https?:\/\/[^>\s]+)>$/;
    const BARE_LINK = /^(https?:\/\/[^\s<>"'`]+)$/;
    const TRAILING = /[),.;:!?，。；：！？）」』>]+$/;

    export function safeHttpUrl(href: string): string | null {
      try {
        const url = new URL(href);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return null;
        }
        return url.href;
      } catch {
        return null;
      }
    }

    /** Pull trailing sentence punctuation off a bare URL, keeping balanced ). */
    export function peelAutolink(raw: string): { href: string; trail: string } {
      let href = raw;
      let trail = "";
      while (href.length > 0) {
        const last = href[href.length - 1]!;
        if (TRAILING.test(last)) {
          if (last === ")" && count(href, "(") >= count(href, ")")) {
            break;
          }
          href = href.slice(0, -1);
          trail = last + trail;
          continue;
        }
        break;
      }
      return { href, trail };
    }

    export function splitInline(text: string): InlinePiece[] {
      const pieces: InlinePiece[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      TOKEN.lastIndex = 0;
      while ((match = TOKEN.exec(text)) !== null) {
        if (match.index > last) {
          pieces.push({ type: "text", text: text.slice(last, match.index) });
        }
        pieces.push(...piecesFor(match[0]!));
        last = match.index + match[0]!.length;
      }
      if (last < text.length) {
        pieces.push({ type: "text", text: text.slice(last) });
      }
      return pieces;
    }

    function piecesFor(token: string): InlinePiece[] {
      if (token.startsWith("`")) {
        return [{ type: "code", text: token.slice(1, -1) }];
      }
      if (token.startsWith("**")) {
        return [{ type: "bold", text: token.slice(2, -2) }];
      }
      const markdown = MARKDOWN_LINK.exec(token);
      if (markdown) {
        const href = safeHttpUrl(markdown[2]!);
        return href ? [{ type: "link", href, text: markdown[1]! }] : [{ type: "text", text: token }];
      }
      const angled = ANGLE_LINK.exec(token);
      if (angled) {
        const href = safeHttpUrl(angled[1]!);
        return href ? [{ type: "link", href, text: angled[1]! }] : [{ type: "text", text: token }];
      }
      if (BARE_LINK.test(token)) {
        const { href, trail } = peelAutolink(token);
        const safe = safeHttpUrl(href);
        if (safe) {
          const pieces: InlinePiece[] = [{ type: "link", href: safe, text: href }];
          if (trail) {
            pieces.push({ type: "text", text: trail });
          }
          return pieces;
        }
      }
      return [{ type: "text", text: token }];
    }

    function count(text: string, char: string): number {
      let total = 0;
      for (const item of text) {
        if (item === char) {
          total += 1;
        }
      }
      return total;
    }
