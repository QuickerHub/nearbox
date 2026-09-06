import { spawn, type ChildProcess } from "node:child_process";

/**
 * Stop a local child process and everything it spawned. Agent CLIs start
 * helpers of their own (MCP servers, shells), which would otherwise outlive
 * them: Windows has no process groups, so `taskkill /t` walks the tree.
 */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child || child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 5000).unref();
}
