import assert from "node:assert/strict";
import test from "node:test";
import { mergeAgentSetting, restrictSettingsPatch } from "./settings-patch.ts";

test("restrictSettingsPatch lets phones change access/model but not command or remote", () => {
  const patch = restrictSettingsPatch("phone", {
    remoteControlEnabled: true,
    launchAtLogin: true,
    closeToTray: false,
    notifyOnRunFinish: false,
    maxConcurrentRuns: 3,
    preferredHost: "10.0.0.1",
    agents: {
      cursor: { access: "full", model: "gpt", command: "C:\\\\evil\\\\cursor.exe" },
    },
  });
  assert.deepEqual(patch, {
    maxConcurrentRuns: 3,
    agents: {
      cursor: { access: "full", model: "gpt" },
    },
  });
  assert.equal("command" in (patch.agents?.cursor ?? {}), false);
});

test("restrictSettingsPatch leaves desktop patches intact", () => {
  const body = { remoteControlEnabled: true, agents: { cursor: { command: "/opt/cursor" } } };
  assert.equal(restrictSettingsPatch("desktop", body), body);
});

test("mergeAgentSetting preserves command when only access changes", () => {
  assert.deepEqual(mergeAgentSetting({ access: "safe", command: "/usr/bin/cursor", model: "a" }, { access: "full" }), {
    access: "full",
    model: "a",
    command: "/usr/bin/cursor",
  });
  assert.deepEqual(mergeAgentSetting({ access: "full", command: "x" }, { command: "  " }), {
    access: "full",
    model: undefined,
    command: undefined,
  });
  assert.deepEqual(mergeAgentSetting({ access: "safe", command: "keep" }, { access: "full" }), {
    access: "full",
    model: undefined,
    command: "keep",
  });
});

test("restrictSettingsPatch drops phone-only command overrides", () => {
  const patch = restrictSettingsPatch("phone", {
    agents: { cursor: { command: "C:\\evil\\cursor.exe" } },
  });
  assert.deepEqual(patch, {});
});
