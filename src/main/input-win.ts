import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

/**
 * Injects mouse/keyboard input into the local desktop. On Windows this drives a
 * long-lived PowerShell process that P/Invokes user32 `SendInput`; the process
 * reads one command per line on stdin (see remote-input.ts for the grammar).
 */
export interface InputSink {
  readonly supported: boolean;
  /** Resolves once the backend is ready to accept commands (immediately when unsupported). */
  ready(): Promise<boolean>;
  send(commands: string[]): void;
  dispose(): void;
}

/** How long we wait for PowerShell to print NB_READY before giving up. */
export const INJECTOR_READY_TIMEOUT_MS = 20_000;

/** Hostile / broken stdout before NB_READY must not fill memory. */
export const MAX_INJECTOR_BANNER_BYTES = 4096;

/** Append a stdout chunk; `done` when NB_READY appears or the buffer is full. */
export function appendInjectorBanner(
  previous: string,
  chunk: Buffer | string,
  maxBytes = MAX_INJECTOR_BANNER_BYTES,
): { banner: string; ready: boolean; overflow: boolean } {
  const piece = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  if (!piece) {
    return {
      banner: previous,
      ready: previous.includes("NB_READY"),
      overflow: previous.length >= maxBytes,
    };
  }
  const room = Math.max(0, maxBytes - previous.length);
  const next = room > 0 ? previous + piece.slice(0, room) : previous;
  const overflow = next.length >= maxBytes && !next.includes("NB_READY");
  return { banner: next, ready: next.includes("NB_READY"), overflow };
}

// C# compiled once via Add-Type. Only user32 is needed, so it works on stock
// Windows PowerShell without extra assemblies. "NB_READY" tells us the loop is up.
const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;
public static class Nb {
  const int MOUSE = 0, KEYBOARD = 1;
  const uint MOVE = 0x0001, ABSOLUTE = 0x8000;
  const uint LDOWN = 0x0002, LUP = 0x0004, RDOWN = 0x0008, RUP = 0x0010, MDOWN = 0x0020, MUP = 0x0040, WHEEL = 0x0800, HWHEEL = 0x1000;
  const uint KEYUP = 0x0002, UNICODE = 0x0004, EXTENDED = 0x0001;
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public int type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] p, int cb);
  static readonly int CB = Marshal.SizeOf(typeof(INPUT));
  static void Send(INPUT[] a) { SendInput((uint)a.Length, a, CB); }
  static void Move(int x, int y) { var i = new INPUT { type = MOUSE }; i.u.mi = new MOUSEINPUT { dx = x, dy = y, dwFlags = MOVE | ABSOLUTE }; Send(new[] { i }); }
  static void Button(int b, bool down) {
    uint f = b == 2 ? (down ? RDOWN : RUP) : b == 3 ? (down ? MDOWN : MUP) : (down ? LDOWN : LUP);
    var i = new INPUT { type = MOUSE }; i.u.mi = new MOUSEINPUT { dwFlags = f }; Send(new[] { i });
  }
  static void Wheel(int d, bool horizontal) { var i = new INPUT { type = MOUSE }; i.u.mi = new MOUSEINPUT { mouseData = (uint)d, dwFlags = horizontal ? HWHEEL : WHEEL }; Send(new[] { i }); }
  static void Key(ushort vk, bool down, bool ext) { uint f = (down ? 0u : KEYUP) | (ext ? EXTENDED : 0u); var i = new INPUT { type = KEYBOARD }; i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = f }; Send(new[] { i }); }
  static void Char(ushort c) {
    var d = new INPUT { type = KEYBOARD }; d.u.ki = new KEYBDINPUT { wScan = c, dwFlags = UNICODE };
    var u = new INPUT { type = KEYBOARD }; u.u.ki = new KEYBDINPUT { wScan = c, dwFlags = UNICODE | KEYUP };
    Send(new[] { d, u });
  }
  public static void Do(string line) {
    if (string.IsNullOrEmpty(line)) return;
    var p = line.Split(' ');
    try {
      switch (p[0]) {
        case "M": Move(int.Parse(p[1]), int.Parse(p[2])); break;
        case "B": Button(int.Parse(p[1]), p[2] == "1"); break;
        case "W": Wheel(int.Parse(p[1]), false); break;
        case "H": Wheel(int.Parse(p[1]), true); break;
        case "K": Key((ushort)int.Parse(p[1]), p[2] == "1", p.Length > 3 && p[3] == "1"); break;
        case "U": Char((ushort)int.Parse(p[1])); break;
      }
    } catch { }
  }
}
`;

const BOOTSTRAP = `$ErrorActionPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
${CSHARP}
'@
[Console]::Out.WriteLine('NB_READY')
while(($line=[Console]::In.ReadLine()) -ne $null){ [Nb]::Do($line) }`;

function powershellPath(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

class WindowsInputInjector implements InputSink {
  readonly supported = true;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private isReady = false;
  private pending: string[] = [];
  private disposed = false;
  private readyTimer: NodeJS.Timeout | null = null;

  ready(): Promise<boolean> {
    return this.start();
  }

  send(commands: string[]): void {
    if (this.disposed || commands.length === 0) {
      return;
    }
    if (this.isReady && this.child) {
      this.writeNow(commands);
      return;
    }
    this.pending.push(...commands);
    void this.start();
  }

  private start(): Promise<boolean> {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.readyTimer) {
          clearTimeout(this.readyTimer);
          this.readyTimer = null;
        }
        if (!ok) {
          this.teardown();
        }
        resolve(ok);
      };
      let child: ChildProcessWithoutNullStreams;
      try {
        const encoded = Buffer.from(BOOTSTRAP, "utf16le").toString("base64");
        child = spawn(powershellPath(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        finish(false);
        return;
      }
      this.child = child;
      let banner = "";
      this.readyTimer = setTimeout(() => finish(false), INJECTOR_READY_TIMEOUT_MS);
      const onData = (chunk: Buffer) => {
        const next = appendInjectorBanner(banner, chunk);
        banner = next.banner;
        if (next.ready) {
          child.stdout.off("data", onData);
          this.isReady = true;
          if (this.pending.length) {
            this.writeNow(this.pending);
            this.pending = [];
          }
          finish(true);
          return;
        }
        if (next.overflow) {
          child.stdout.off("data", onData);
          finish(false);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", () => undefined);
      child.on("error", () => finish(false));
      child.on("exit", () => {
        // Exit before NB_READY must settle ready() — otherwise callers hang forever.
        if (!this.isReady) {
          finish(false);
        } else {
          this.teardown();
        }
      });
    });
    return this.readyPromise;
  }

  private writeNow(commands: string[]): void {
    try {
      this.child?.stdin.write(`${commands.join("\n")}\n`);
    } catch {
      this.teardown();
    }
  }

  private teardown(): void {
    this.isReady = false;
    this.readyPromise = null;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.teardown();
  }
}

class NoopInjector implements InputSink {
  readonly supported = false;
  ready(): Promise<boolean> {
    return Promise.resolve(false);
  }
  send(): void {
    /* nothing to drive on this platform */
  }
  dispose(): void {
    /* nothing to tear down */
  }
}

export function createInputInjector(): InputSink {
  return process.platform === "win32" ? new WindowsInputInjector() : new NoopInjector();
}
