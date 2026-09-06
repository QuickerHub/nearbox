import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, shell } from "electron";
import { DEFAULT_PORT, type HostSnapshot } from "@shared/protocol";
import { LanServer } from "./lan-server";

const isDev = import.meta.env.DEV;

let mainWindow: BrowserWindow | null = null;
let server: LanServer | null = null;
const desktopSecret = randomBytes(24).toString("base64url");

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: "Nearbox",
    backgroundColor: "#f3f5f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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

async function startHost(): Promise<HostSnapshot> {
  if (server) {
    return server.snapshot();
  }
  const next = new LanServer({
    userData: join(app.getPath("userData"), "nearbox"),
    rendererRoot: isDev ? null : join(__dirname, "../renderer"),
    vitePort: 5173,
    desktopSecret,
    port: DEFAULT_PORT,
  });
  await next.start();
  next.on("snapshot", (snapshot: HostSnapshot) => {
    mainWindow?.webContents.send("nearbox:snapshot", snapshot);
  });
  server = next;
  return next.snapshot();
}

app.whenReady().then(async () => {
  ipcMain.handle("nearbox:bootstrap", async () => {
    const snapshot = await startHost();
    return {
      snapshot,
      desktopSecret,
      port: snapshot.port,
    };
  });
  ipcMain.handle("nearbox:refresh-invite", async () => server?.refreshInvite() ?? null);
  ipcMain.handle("nearbox:set-host", async (_event, host: string) => server?.setSelectedHost(host) ?? null);
  ipcMain.handle("nearbox:send-text", async (_event, text: string) => server?.sendDesktopText(text) ?? null);
  ipcMain.handle("nearbox:open-inbox", async () => {
    if (!server) {
      return;
    }
    await shell.openPath(server.inboxDir);
  });
  ipcMain.handle("nearbox:open-file", async (_event, fileId: string) => {
    const snapshot = server?.snapshot();
    const message = snapshot?.messages.find((item) => item.file?.id === fileId);
    if (!message?.file) {
      return;
    }
    const url = `http://127.0.0.1:${snapshot?.port}/api/files/${fileId}?token=${desktopSecret}`;
    await shell.openExternal(url);
  });

  await startHost();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void server?.stop();
});
