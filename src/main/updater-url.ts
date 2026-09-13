/**
 * Installer downloads must stay on GitHub's HTTPS hosts. A compromised or
 * spoofed release payload with file:// or http:// assets must not be followed.
 */

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

/** True when GitHub's /releases/latest body is a release object (not an error array/HTML). */
export function isGithubReleasePayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
