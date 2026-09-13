import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AGENT_KINDS } from "@shared/protocol";
import { COMMAND_NAMES, extraPathEntries, spawnEnv, unwrapShim } from "./agents.ts";

test("COMMAND_NAMES covers every agent kind with at least one binary name", () => {
  assert.deepEqual(Object.keys(COMMAND_NAMES).sort(), [...AGENT_KINDS].sort());
  for (const kind of AGENT_KINDS) {
    assert.ok(COMMAND_NAMES[kind].length >= 1, kind);
    assert.ok(COMMAND_NAMES[kind].every((name) => name.trim().length > 0), kind);
  }
  assert.deepEqual(COMMAND_NAMES.cursor, ["cursor-agent", "agent"]);
});

test("extraPathEntries only returns directories that exist", () => {
  for (const entry of extraPathEntries()) {
    assert.ok(entry.length > 0);
    assert.equal(existsSync(entry), true, entry);
  }
});

test("extraPathEntries includes ~/.local/bin when that directory exists", () => {
  const homeBin = join(homedir(), ".local", "bin");
  mkdirSync(homeBin, { recursive: true });
  assert.ok(extraPathEntries().includes(homeBin));
});

test("spawnEnv forces dumb TTY, strips Electron/Chrome/Google, and sets compile cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "nearbox-agents-env-"));
  const previous = {
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
    CHROME_DESKTOP: process.env.CHROME_DESKTOP,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    CURSOR_CONFIG_DIR: process.env.CURSOR_CONFIG_DIR,
    NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE,
  };
  try {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    process.env.CHROME_DESKTOP = "nearbox.desktop";
    process.env.GOOGLE_API_KEY = "secret";
    process.env.NODE_OPTIONS = "--max-old-space-size=64";
    process.env.CURSOR_CONFIG_DIR = dir;
    delete process.env.NODE_COMPILE_CACHE;

    const env = spawnEnv();
    assert.equal(env.NO_COLOR, "1");
    assert.equal(env.FORCE_COLOR, "0");
    assert.equal(env.TERM, "dumb");
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.CHROME_DESKTOP, undefined);
    assert.equal(env.GOOGLE_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.ok(env.NODE_COMPILE_CACHE?.includes("nearbox-node-compile-cache"));
    assert.ok((env.PATH ?? "").length >= (process.env.PATH ?? "").length);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unwrapShim passes through native binaries and empty extensions", () => {
  assert.deepEqual(unwrapShim("/usr/local/bin/claude"), {
    file: "/usr/local/bin/claude",
    prefixArgs: [],
    display: "/usr/local/bin/claude",
    viaCmd: false,
  });
  assert.deepEqual(unwrapShim("/opt/homebrew/bin/cursor-agent"), {
    file: "/opt/homebrew/bin/cursor-agent",
    prefixArgs: [],
    display: "/opt/homebrew/bin/cursor-agent",
    viaCmd: false,
  });
});

test(
  "unwrapShim on Windows prefers the .exe next to a .cmd shim",
  { skip: process.platform !== "win32" ? "Windows shim layout" : false },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "nearbox-shim-"));
    try {
      const exe = join(dir, "claude.exe");
      const cmd = join(dir, "claude.cmd");
      writeFileSync(exe, "");
      writeFileSync(cmd, '@"%dp0%\\claude.exe" %*\r\n');
      const resolved = unwrapShim(cmd);
      assert.equal(resolved.file, exe);
      assert.deepEqual(resolved.prefixArgs, []);
      assert.equal(resolved.viaCmd, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
