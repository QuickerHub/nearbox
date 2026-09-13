import assert from "node:assert/strict";
import test from "node:test";
import { isWindowsStyleAbsolute, resolvePowershellPath, resolveWindowsRoot } from "./powershell-home.ts";

test("isWindowsStyleAbsolute accepts drive and UNC forms", () => {
  assert.equal(isWindowsStyleAbsolute("C:\\Windows"), true);
  assert.equal(isWindowsStyleAbsolute("D:/Win"), true);
  assert.equal(isWindowsStyleAbsolute("\\\\server\\share"), true);
  assert.equal(isWindowsStyleAbsolute("/usr"), true);
  assert.equal(isWindowsStyleAbsolute(".\\evil"), false);
  assert.equal(isWindowsStyleAbsolute("relative"), false);
  assert.equal(isWindowsStyleAbsolute(""), false);
});

test("resolveWindowsRoot requires an absolute SystemRoot/windir", () => {
  assert.equal(resolveWindowsRoot({}), "C:\\Windows");
  assert.equal(resolveWindowsRoot({ SystemRoot: "" }), "C:\\Windows");
  assert.equal(resolveWindowsRoot({ SystemRoot: "   " }), "C:\\Windows");
  assert.equal(resolveWindowsRoot({ SystemRoot: ".\\evil" }), "C:\\Windows");
  assert.equal(resolveWindowsRoot({ SystemRoot: "relative" }), "C:\\Windows");
  assert.equal(resolveWindowsRoot({ windir: "C:\\Win" }), "C:\\Win");
  assert.equal(resolveWindowsRoot({ SystemRoot: "D:\\Windows", windir: "C:\\Win" }), "D:\\Windows");
});

test("resolvePowershellPath joins under the resolved root", () => {
  const path = resolvePowershellPath({ SystemRoot: "C:\\Windows" });
  assert.match(path, /System32/);
  assert.match(path, /powershell\.exe$/i);
});
