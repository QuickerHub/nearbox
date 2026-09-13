import assert from "node:assert/strict";
import test from "node:test";
import { withDelegationPath } from "./delegation.ts";

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

test("withDelegationPath falls back to Path on Windows-style env and tolerates empty PATH", () => {
  const fromPath = withDelegationPath({ Path: "C:\\Windows\\System32" } as NodeJS.ProcessEnv, "D:\\nearbox\\bin");
  assert.match(fromPath.PATH ?? "", /nearbox/);
  assert.ok((fromPath.PATH ?? "").includes("nearbox"));

  const empty = withDelegationPath({}, "/tmp/nearbox-bin");
  assert.equal(empty.PATH, "/tmp/nearbox-bin");
});
