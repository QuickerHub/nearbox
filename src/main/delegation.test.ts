import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installDelegationBin, withDelegationPath } from "./delegation.ts";

test("withDelegationPath prepends binDir and keeps the rest of PATH", () => {
  const next = withDelegationPath({ PATH: "/usr/bin:/bin", HOME: "/home/cea" }, "/data/bin");
  const separator = process.platform === "win32" ? ";" : ":";
  assert.equal(next.PATH, ["/data/bin", "/usr/bin:/bin"].join(separator));
  assert.equal(next.HOME, "/home/cea");
  if (process.platform === "win32") {
    assert.equal(next.Path, next.PATH);
  } else {
    assert.equal(next.Path, undefined);
  }
});

test("withDelegationPath falls back to Path and tolerates empty PATH", () => {
  const fromPath = withDelegationPath({ Path: "C:\\Windows\\System32" } as NodeJS.ProcessEnv, "D:\\nearbox\\bin");
  assert.match(fromPath.PATH ?? "", /nearbox/);

  const empty = withDelegationPath({}, "/tmp/nearbox-bin");
  assert.equal(empty.PATH, "/tmp/nearbox-bin");
});

test("installDelegationBin writes nearbox (+ .cmd on Windows) and sets execute bit", async () => {
  const root = await mkdtemp(join(tmpdir(), "nearbox-deleg-"));
  try {
    const electron = join(root, "Nearbox App");
    const cli = join(root, "cli", "nearbox.mjs");
    await writeFile(electron, "", "utf8");
    await mkdir(join(root, "cli"), { recursive: true });
    await writeFile(cli, "", "utf8");
    // Start without +x so we can see chmod took effect on POSIX (and Git Bash).
    const binDir = await installDelegationBin(root, electron, cli);
    const launcher = join(binDir, "nearbox");
    const body = await readFile(launcher, "utf8");
    assert.match(body, /ELECTRON_RUN_AS_NODE=1/);
    assert.match(body, /nearbox\.mjs/);
    const mode = (await stat(launcher)).mode & 0o111;
    assert.ok(mode !== 0, "nearbox launcher must be executable");
    if (process.platform === "win32") {
      const cmd = await readFile(join(binDir, "nearbox.cmd"), "utf8");
      assert.match(cmd, /ELECTRON_RUN_AS_NODE=1/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
