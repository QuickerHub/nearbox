import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { createInputInjector } from "./input-win.ts";
import { moveCommand } from "./remote-input.ts";

const execFileAsync = promisify(execFile);

// Drives the real cursor, so it only runs on an interactive Windows desktop.
// CI runners opt in with NEARBOX_INPUT_TEST=1; anyone can opt out with NEARBOX_SKIP_INPUT_TEST=1.
const skipReason =
  process.platform !== "win32"
    ? "Windows only"
    : process.env.NEARBOX_SKIP_INPUT_TEST
      ? "NEARBOX_SKIP_INPUT_TEST is set"
      : process.env.CI && process.env.NEARBOX_INPUT_TEST !== "1"
        ? "CI without NEARBOX_INPUT_TEST=1"
        : undefined;

interface Point {
  x: number;
  y: number;
}

async function readCursor(): Promise<Point> {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output ($p.X.ToString() + ' ' + $p.Y.ToString())";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000 });
  const [x, y] = stdout.trim().split(/\s+/).map(Number);
  assert.ok(Number.isFinite(x) && Number.isFinite(y), `unexpected cursor output: ${stdout}`);
  return { x: x!, y: y! };
}

async function restoreCursor(point: Point): Promise<void> {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${point.x}, ${point.y})`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000 }).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the injector really moves the Windows cursor where the viewer points", { skip: skipReason, timeout: 60_000 }, async () => {
  const injector = createInputInjector();
  assert.equal(injector.supported, true);
  const original = await readCursor();
  try {
    const ready = await Promise.race([injector.ready(), sleep(30_000).then(() => false)]);
    assert.equal(ready, true, "PowerShell SendInput helper did not start");

    injector.send([moveCommand(0.25, 0.25)]);
    await sleep(250);
    const first = await readCursor();

    injector.send([moveCommand(0.75, 0.75)]);
    await sleep(250);
    const second = await readCursor();

    // Direction is what we can assert independently of DPI scaling and monitor layout.
    assert.ok(second.x - first.x > 100, `cursor should have moved right: ${first.x} -> ${second.x}`);
    assert.ok(second.y - first.y > 100, `cursor should have moved down: ${first.y} -> ${second.y}`);
  } finally {
    injector.dispose();
    await restoreCursor(original);
  }
});

test("unsupported platforms get a silent no-op sink", () => {
  const injector = createInputInjector();
  if (process.platform === "win32") {
    assert.equal(injector.supported, true);
    injector.dispose();
    return;
  }
  assert.equal(injector.supported, false);
  injector.send(["M 0 0"]);
  injector.dispose();
});
