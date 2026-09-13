/**
 * Harden GitHub release payloads before they reach status/download paths.
 * Round 6 trusts installer hostnames; this layer also validates field types,
 * release-page URLs, and download size so a weird JSON body cannot crash
 * refresh or open an untrusted browser tab.
 */

export const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

/** Same host rule as installer downloads — release notes links open via openExternal. */
export function isTrustedReleasePageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === "github.com" || host === "www.github.com";
}

export function isTrustedInstallerUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === "github.com" || host.endsWith(".githubusercontent.com");
}

/** Coerce a release tag to a short string; non-strings are ignored. */
export function releaseTagName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().slice(0, 64);
  return trimmed || undefined;
}

/** Notes must be a string — objects/arrays would throw on `.trim()`. */
export function releaseNotes(value: unknown, max = 400): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, max);
}

export function releaseHtmlUrl(value: unknown, fallback: string): string {
  if (typeof value === "string" && isTrustedReleasePageUrl(value)) {
    return value;
  }
  return fallback;
}

export interface ReleaseAssetLike {
  name: string;
  browser_download_url: string;
}

/** Keep only assets with string name + https GitHub download URL. */
export function sanitizeReleaseAssets(assets: unknown): ReleaseAssetLike[] {
  if (!Array.isArray(assets)) {
    return [];
  }
  const out: ReleaseAssetLike[] = [];
  for (const item of assets) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) {
      continue;
    }
    if (typeof record.browser_download_url !== "string" || !isTrustedInstallerUrl(record.browser_download_url)) {
      continue;
    }
    out.push({ name: record.name, browser_download_url: record.browser_download_url });
  }
  return out;
}

/** True when Content-Length (or bytes received) exceeds the installer ceiling. */
export function isInstallerTooLarge(byteLength: number): boolean {
  return !Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_INSTALLER_BYTES;
}
