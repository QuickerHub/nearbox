/**
 * Release page URL hygiene. Empty / non-string html_url must not become a blank
 * settings link; full github.com trust checks live in other rounds.
 */

/** Prefer a non-blank string; otherwise the known releases page. */
export function resolveReleaseHtmlUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

/** Coerce release body to a short notes string without throwing on weird JSON. */
export function coerceReleaseNotes(value: unknown, max = 400): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, max);
}
