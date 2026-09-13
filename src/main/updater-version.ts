/**
 * Release tag → installer cache basename. Round 3 blocked `../` escape; this
 * also strips Windows-illegal filename characters and empty/whitespace tags so
 * `createWriteStream` cannot throw or write a surprising path.
 */

const WIN_BAD = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Filesystem-safe version segment for `Nearbox-${version}-win-x64.exe`. */
export function sanitizeInstallerVersion(version: string): string | null {
  const cleaned = version
    .trim()
    .replace(/^v/i, "")
    .replace(WIN_BAD, "-")
    .replace(/\.\./g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return cleaned || null;
}

/**
 * `tag_name: "v"` / `"   "` must not become `latest: ""` (truthy checks in the
 * UI treat empty as a real channel).
 */
export function normalizeLatestTag(tagName: unknown): string | null {
  if (typeof tagName !== "string") {
    return null;
  }
  return sanitizeInstallerVersion(tagName);
}
