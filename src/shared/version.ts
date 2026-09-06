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
