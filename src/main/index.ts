import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { AGENT_LABELS, type AgentRun, DEFAULT_PORT, type HostSettings, RUN_STATUS_LABELS } from "@shared/protocol";
import { spawnEnv } from "./agents";
import { TaskHub } from "./hub";
import { LanServer } from "./lan-server";

const isDev = import.meta.env.DEV;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: LanServer | null = null;
let hub: TaskHub | null = null;
let quitting = false;
let trayHintShown = false;
// Letting the launcher pin the secret makes local API testing possible; the default is per-process random.
const desktopSecret = process.env.NEARBOX_DESKTOP_SECRET || randomBytes(24).toString("base64url");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  showWindow();
});

function resourcePath(...segments: string[]): string {
  const candidates = [join(process.resourcesPath ?? "", ...segments), join(process.cwd(), "resources", ...segments)];
  return candidates.find((item) => existsSync(item)) ?? candidates[0]!;
}

function appIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(resourcePath("icons", "icon.png"));
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function trayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(resourcePath("icons", "tray.png"));
  if (icon.isEmpty()) {
    return appIcon().resize({ width: 16, height: 16 });
  }
  return icon;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: "Nearbox",
    backgroundColor: "#141414",
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (quitting || !(hub?.settings.closeToTray ?? true)) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: "Nearbox 还在后台运行",
        body: "手机仍然可以连接和派发任务。要彻底退出，请在托盘图标右键选择「退出」。",
        silent: true,
      }).show();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function showWindow(hash?: string): void {
  if (!mainWindow) {
    void createWindow().then(() => {
      if (hash) {
        mainWindow?.webContents.once("did-finish-load", () => mainWindow?.webContents.send("nearbox:navigate", hash));
      }
    });
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (hash) {
    mainWindow.webContents.send("nearbox:navigate", hash);
  }
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip("Nearbox");
  refreshTrayMenu();
  tray.on("click", () => showWindow());
  tray.on("double-click", () => showWindow());
}

function refreshTrayMenu(): void {
  if (!tray) {
    return;
  }
  const snapshot = server?.snapshot();
  const running = snapshot?.runs.filter((run) => run.status === "running").length ?? 0;
  const queued = snapshot?.runs.filter((run) => run.status === "queued").length ?? 0;
  const phones = server?.onlinePhones() ?? 0;
  const menu = Menu.buildFromTemplate([
    { label: "打开 Nearbox", click: () => showWindow() },
    { type: "separator" },
    {
      label: snapshot?.selectedHost ? `${snapshot.selectedHost}:${snapshot.port}` : "未发现局域网地址",
      enabled: false,
    },
    { label: phones ? `${phones} 台手机在线` : "没有手机在线", enabled: false },
    { label: running || queued ? `Agent：${running} 运行中 · ${queued} 排队` : "Agent 空闲", enabled: false },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function applyLoginItem(settings: HostSettings): void {
  if (isDev || process.platform === "linux") {
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ["--hidden"] });
  } catch {
    // Not fatal: some environments (portable zip) cannot register a login item.
  }
}

function notifyRunFinished(run: AgentRun): void {
  if (!hub?.settings.notifyOnRunFinish || !Notification.isSupported()) {
    return;
  }
  const task = hub.tasks.find((item) => item.id === run.taskId);
  const title = `${AGENT_LABELS[run.agent]} · ${RUN_STATUS_LABELS[run.status]}`;
  const body = [task?.title ?? "", run.status === "succeeded" ? run.summary ?? "" : run.error ?? ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 240);
  const notification = new Notification({ title, body: body || "运行结束", silent: false });
  notification.on("click", () => showWindow(`#/run/${run.id}`));
  notification.show();
}

async function startHost(): Promise<void> {
  if (server) {
    return;
  }
  const userData = join(app.getPath("userData"), "nearbox");
  const nextHub = new TaskHub(join(userData, "data"));
  await nextHub.init();
  const next = new LanServer({
    hub: nextHub,
    userData,
    rendererRoot: isDev ? null : join(__dirname, "../renderer"),
    vitePort: 5173,
    desktopSecret,
    appVersion: app.getVersion(),
    apkPath: resolveApkPath(),
    port: DEFAULT_PORT,
  });
  await next.start();
  next.on("snapshot", () => refreshTrayMenu());
  nextHub.on("run-finished", (run: AgentRun) => notifyRunFinished(run));
  nextHub.on("settings", (settings: HostSettings) => applyLoginItem(settings));
  hub = nextHub;
  server = next;
  applyLoginItem(nextHub.settings);
}

function registerIpc(): void {
  ipcMain.handle("nearbox:bootstrap", async () => {
    await startHost();
    return { desktopSecret, port: server!.port, version: app.getVersion() };
  });
  ipcMain.handle("nearbox:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? BrowserWindow.getAllWindows()[0]!, {
      title: "选择项目目录",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("nearbox:open-path", async (_event, path: string) => {
    if (typeof path === "string" && existsSync(path)) {
      await shell.openPath(path);
    }
  });
  ipcMain.handle("nearbox:show-in-folder", async (_event, path: string) => {
    if (typeof path === "string" && existsSync(path)) {
      shell.showItemInFolder(path);
    }
  });
  ipcMain.handle("nearbox:open-external", async (_event, url: string) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle("nearbox:open-in-editor", async (_event, path: string) => {
    if (typeof path !== "string" || !existsSync(path)) {
      return false;
    }
    const env = spawnEnv();
    try {
      const child =
        process.platform === "win32"
          ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"cursor.cmd "${path}""`], {
              env,
              detached: true,
              stdio: "ignore",
              windowsHide: true,
              windowsVerbatimArguments: true,
            })
          : spawn("cursor", [path], { env, detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
      return true;
    } catch {
      await shell.openPath(path);
      return false;
    }
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await startHost();
  createTray();
  const startHidden = process.argv.includes("--hidden");
  if (!startHidden) {
    await createWindow();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep serving phones from the tray; the tray menu owns "退出".
  if (!(hub?.settings.closeToTray ?? true)) {
    quitting = true;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  quitting = true;
  if (!hub && !server) {
    return;
  }
  event.preventDefault();
  const pendingHub = hub;
  const pendingServer = server;
  hub = null;
  server = null;
  void Promise.all([pendingHub?.shutdown(), pendingServer?.stop()]).finally(() => {
    tray?.destroy();
    tray = null;
    app.exit(0);
  });
});

function resolveApkPath(): string | null {
  const candidates = [join(process.resourcesPath, "nearbox.apk"), join(process.cwd(), "resources", "nearbox.apk")];
  return candidates.find((item) => existsSync(item)) ?? null;
}
