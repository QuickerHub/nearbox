/**
 * Windows PE images begin with the MZ DOS stub magic. GitHub error HTML,
 * truncated downloads, and random cache garbage must not be launched as the
 * Nearbox installer.
 */
export function hasWindowsPeMzHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}
