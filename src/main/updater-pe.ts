/**
 * Windows PE images begin with the MZ DOS stub magic. Cached installers must
 * be re-checked before launch — a truncated or replaced cache file can keep
 * the in-memory ready path while no longer being a real .exe.
 */

/** Smallest plausible installer; MZ-only stubs must not be launched. */
export const MIN_INSTALLER_BYTES = 1024;

export function hasWindowsPeMzHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

/** True when size + DOS stub look like a real Windows installer image. */
export function installerLooksUsable(byteLength: number, header: Uint8Array): boolean {
  if (!Number.isFinite(byteLength) || byteLength < MIN_INSTALLER_BYTES) {
    return false;
  }
  return hasWindowsPeMzHeader(header);
}
