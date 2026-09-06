import { contextBridge, ipcRenderer } from "electron";

export interface NearboxDesktopApi {
  isDesktop: true;
  bootstrap(): Promise<{ desktopSecret: string; port: number; version: string }>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  showInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openInEditor(path: string): Promise<boolean>;
  onNavigate(listener: (hash: string) => void): () => void;
}

const api: NearboxDesktopApi = {
  isDesktop: true,
  bootstrap: () => ipcRenderer.invoke("nearbox:bootstrap"),
  pickFolder: () => ipcRenderer.invoke("nearbox:pick-folder"),
  openPath: (path) => ipcRenderer.invoke("nearbox:open-path", path),
  showInFolder: (path) => ipcRenderer.invoke("nearbox:show-in-folder", path),
  openExternal: (url) => ipcRenderer.invoke("nearbox:open-external", url),
  openInEditor: (path) => ipcRenderer.invoke("nearbox:open-in-editor", path),
  onNavigate: (listener) => {
    const handler = (_event: unknown, hash: string) => listener(hash);
    ipcRenderer.on("nearbox:navigate", handler);
    return () => {
      ipcRenderer.removeListener("nearbox:navigate", handler);
    };
  },
};

contextBridge.exposeInMainWorld("nearboxDesktop", api);
