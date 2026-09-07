export const PROTOCOL_VERSION = 1;

export function versionCodeFromName(version: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    throw new Error(`版本号必须是 semver，例如 0.1.0，收到：${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function stripTagPrefix(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

export function tryVersionCode(version: string): number | null {
  try {
    return versionCodeFromName(stripTagPrefix(version));
  } catch {
    return null;
  }
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = tryVersionCode(latest);
  const now = tryVersionCode(current);
  return next !== null && now !== null && next > now;
}

/** Android WebView adds `NearboxShell/x.y.z` to the user agent. */
export function shellVersionFromUserAgent(ua: string): string | undefined {
  return /NearboxShell\/(\d+\.\d+\.\d+)/.exec(ua)?.[1];
}
