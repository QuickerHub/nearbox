import { contextBridge, ipcRenderer } from "electron";
import type { HostSnapshot, InviteInfo, ChatMessage } from "../shared/protocol";

export interface NearboxDesktopApi {
  isDesktop: true;
  bootstrap(): Promise<{ snapshot: HostSnapshot; desktopSecret: string; port: number }>;
  refreshInvite(): Promise<InviteInfo | null>;
  setHost(host: string): Promise<HostSnapshot | null>;
  sendText(text: string): Promise<ChatMessage | null>;
  openInbox(): Promise<void>;
  onSnapshot(listener: (snapshot: HostSnapshot) => void): () => void;
}

const api: NearboxDesktopApi = {
  isDesktop: true,
  bootstrap: () => ipcRenderer.invoke("nearbox:bootstrap"),
  refreshInvite: () => ipcRenderer.invoke("nearbox:refresh-invite"),
  setHost: (host) => ipcRenderer.invoke("nearbox:set-host", host),
  sendText: (text) => ipcRenderer.invoke("nearbox:send-text", text),
  openInbox: () => ipcRenderer.invoke("nearbox:open-inbox"),
  onSnapshot: (listener) => {
    const handler = (_event: unknown, snapshot: HostSnapshot) => listener(snapshot);
    ipcRenderer.on("nearbox:snapshot", handler);
    return () => {
      ipcRenderer.removeListener("nearbox:snapshot", handler);
    };
  },
};

contextBridge.exposeInMainWorld("nearboxDesktop", api);
