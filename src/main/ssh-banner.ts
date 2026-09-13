/**
 * Pure SSH identification-line buffer. Kept free of Node networking so
 * `node --test` can pin the flood cap without loading lan-discover.
 */

/** OpenSSH banners are one short line; a hostile peer must not fill memory before the newline. */
export const MAX_SSH_BANNER_BYTES = 512;

/** Append a socket chunk to the SSH identification buffer; stop once full or a line ends. */
export function appendSshBanner(
  previous: string,
  chunk: Buffer | string,
  maxBytes = MAX_SSH_BANNER_BYTES,
): { banner: string; done: boolean } {
  const piece = typeof chunk === "string" ? chunk : chunk.toString("latin1");
  if (!piece) {
    return { banner: previous, done: previous.includes("\n") || previous.length >= maxBytes };
  }
  const room = Math.max(0, maxBytes - previous.length);
  const next = room > 0 ? previous + piece.slice(0, room) : previous;
  return { banner: next, done: next.includes("\n") || next.length >= maxBytes };
}
