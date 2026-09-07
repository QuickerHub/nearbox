/** First line becomes the title; the rest becomes details. */
export function splitCapture(text: string): { title: string; details: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const newline = normalized.indexOf("\n");
  if (newline === -1) {
    return { title: clampTitle(normalized), details: normalized.length > 120 ? normalized : "" };
  }
  const title = normalized.slice(0, newline).trim();
  const rest = normalized.slice(newline + 1).trim();
  if (!title) {
    return { title: clampTitle(rest), details: rest };
  }
  return { title: clampTitle(title), details: rest };
}

/**
 * Agent-generated session title, when it is worth putting on the task.
 * Long first-line dumps (and titles we already truncated) get replaced; a
 * short name the user typed or we already adopted is left alone.
 */
export function adoptSessionTitle(current: string, incoming: string): string | null {
  const next = clampTitle(incoming);
  if (!next || next === current) {
    return null;
  }
  if (current.length <= 40 && !current.endsWith("…")) {
    return null;
  }
  return next;
}

function clampTitle(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 120 ? `${single.slice(0, 117)}…` : single;
}
