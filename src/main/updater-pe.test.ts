import assert from "node:assert/strict";
import test from "node:test";
import { hasWindowsPeMzHeader, installerLooksUsable, MIN_INSTALLER_BYTES } from "./updater-pe.ts";

test("hasWindowsPeMzHeader accepts MZ only", () => {
  assert.equal(hasWindowsPeMzHeader(Uint8Array.of(0x4d, 0x5a)), true);
  assert.equal(hasWindowsPeMzHeader(Uint8Array.of(0x00, 0x00)), false);
  assert.equal(hasWindowsPeMzHeader(Uint8Array.of(0x4d)), false);
});

test("installerLooksUsable requires size floor plus MZ", () => {
  const mz = Uint8Array.of(0x4d, 0x5a);
  assert.equal(installerLooksUsable(MIN_INSTALLER_BYTES, mz), true);
  assert.equal(installerLooksUsable(MIN_INSTALLER_BYTES - 1, mz), false);
  assert.equal(installerLooksUsable(MIN_INSTALLER_BYTES, Uint8Array.of(0x00, 0x00)), false);
});
