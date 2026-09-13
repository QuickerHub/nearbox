import assert from "node:assert/strict";
import test from "node:test";
import {
  SSH_FAILURE_EXIT,
  buildLauncher,
  isWindowsDevice,
  powershellCommand,
  psQuote,
  remoteAttachmentPath,
  remoteJoin,
  remoteRunPaths,
  shCommand,
  shQuote,
  sshArgs,
} from "./ssh.ts";

test("sshArgs pins batch mode, timeouts, and optional -p/-i/-l", () => {
  assert.equal(SSH_FAILURE_EXIT, 255);
  const basic = sshArgs({ host: "devbox" }, "true");
  assert.ok(basic.includes("-T"));
  assert.ok(basic.includes("BatchMode=yes"));
  assert.ok(basic.includes("ConnectTimeout=12"));
  assert.equal(basic.at(-2), "devbox");
  assert.equal(basic.at(-1), "true");

  const full = sshArgs(
    { host: "10.0.0.2", user: "cea", port: 2222, identityFile: "C:\\keys\\id" },
    "uname",
  );
  assert.ok(full.includes("-p"));
  assert.ok(full.includes("2222"));
  assert.ok(full.includes("-i"));
  assert.ok(full.includes("C:\\keys\\id"));
  assert.ok(full.includes("-l"));
  assert.ok(full.includes("cea"));
  assert.equal(full.at(-2), "10.0.0.2");
});

test("psQuote and shQuote keep shell metacharacters literal", () => {
  assert.equal(psQuote("plain"), "'plain'");
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(shQuote(""), "''");
  assert.equal(shQuote("safe/path_1"), "safe/path_1");
  assert.equal(shQuote("a b"), "'a b'");
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
});

test("powershellCommand base64-encodes UTF-16LE; shCommand wraps sh -c", () => {
  const encoded = powershellCommand("Write-Output 你好");
  assert.match(encoded, /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand /);
  const b64 = encoded.split(" ").at(-1)!;
  assert.equal(Buffer.from(b64, "base64").toString("utf16le"), "Write-Output 你好");
  assert.equal(shCommand("echo hi"), "sh -c 'echo hi'");
});

test("remote path helpers follow the device platform", () => {
  assert.equal(isWindowsDevice({ platform: "windows" }), true);
  assert.equal(isWindowsDevice({ platform: "linux" }), false);

  assert.equal(remoteJoin({ platform: "windows" }, "C:\\Users\\cea", "proj", "src"), "C:\\Users\\cea\\proj\\src");
  assert.equal(remoteJoin({ platform: "linux" }, "/home/cea", "proj", "src"), "/home/cea/proj/src");

  const win = remoteRunPaths({ platform: "windows", home: "C:\\Users\\cea" }, "run-1");
  assert.equal(win.dir, "C:\\Users\\cea\\.nearbox\\runs");
  assert.equal(win.promptFile, "C:\\Users\\cea\\.nearbox\\runs\\run-1.prompt.md");
  assert.equal(win.pidFile, "C:\\Users\\cea\\.nearbox\\runs\\run-1.pid");

  const posix = remoteRunPaths({ platform: "macos", home: "/Users/cea" }, "run-2");
  assert.equal(posix.dir, "/Users/cea/.nearbox/runs");
  assert.equal(posix.pidFile, "/Users/cea/.nearbox/runs/run-2.pid");
  assert.equal(posix.promptFile, "/Users/cea/.nearbox/runs/run-2.prompt.md");

  assert.equal(
    remoteAttachmentPath({ platform: "linux", home: "/home/cea" }, "abcdefghij", "shot.png"),
    "/home/cea/.nearbox/files/abcdefgh-shot.png",
  );
  assert.equal(
    remoteAttachmentPath({ platform: "windows", home: "C:\\Users\\cea" }, "abcdefghij", "a:b*.png"),
    "C:\\Users\\cea\\.nearbox\\files\\abcdefgh-a_b_.png",
  );
});

test("buildLauncher records pid and forces plain output on both platforms", () => {
  const win = buildLauncher(
    { id: "w", name: "pc", host: "pc", user: "cea", platform: "windows", home: "C:\\Users\\cea", status: "online", agents: [], createdAt: "t0" },
    { commandLine: "agent -p", cwd: "C:\\code", pidFile: "C:\\pid" },
  );
  assert.match(win, /EncodedCommand/);
  const winScript = Buffer.from(win.split(" ").at(-1)!, "base64").toString("utf16le");
  assert.match(winScript, /NO_COLOR/);
  assert.match(winScript, /WriteAllText/);
  assert.match(winScript, /agent -p/);

  const posix = buildLauncher(
    { id: "l", name: "box", host: "box", user: "cea", platform: "linux", home: "/home/cea", status: "online", agents: [], createdAt: "t0" },
    { commandLine: "claude -p", cwd: "/tmp/proj", pidFile: "/tmp/agent.pid" },
  );
  assert.match(posix, /^sh -c /);
  assert.match(posix, /NO_COLOR=1/);
  assert.match(posix, /echo \$\$ > /);
  assert.match(posix, /exec claude -p/);
  assert.match(posix, /\/tmp\/proj/);
});
