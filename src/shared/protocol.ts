export { PROTOCOL_VERSION } from "./version";
export const DEFAULT_PORT = 17831;

export type ClientRole = "desktop" | "phone";
export type MessageKind = "text" | "image" | "file";
export type MessageStatus = "sending" | "sent" | "failed" | "cancelled";

export interface DeviceInfo {
  id: string;
  name: string;
  role: ClientRole;
  online: boolean;
  lastSeenAt?: string;
}

export interface FileMeta {
  id: string;
  name: string;
  mediaType: string;
  byteLength: number;
}

export interface ChatMessage {
  id: string;
  from: Pick<DeviceInfo, "id" | "name" | "role">;
  kind: MessageKind;
  text?: string;
  file?: FileMeta;
  createdAt: string;
  status: MessageStatus;
}

export interface ShareLimits {
  maxTextChars: number;
  maxImageBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: ShareLimits = {
  maxTextChars: 8_000,
  maxImageBytes: 32 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
};

export interface InviteInfo {
  url: string;
  token: string;
  pin: string;
  expiresAt: string;
  host: string;
  port: number;
  qrDataUrl?: string;
  apkUrl?: string;
  apkQrDataUrl?: string;
}

export interface HostSnapshot {
  running: boolean;
  hostName: string;
  hostAddresses: string[];
  selectedHost: string;
  port: number;
  invite: InviteInfo | null;
  devices: DeviceInfo[];
  messages: ChatMessage[];
  limits: ShareLimits;
  inboxDir: string;
  appVersion: string;
  protocolVersion: number;
  apkAvailable: boolean;
  listenError?: string;
}

export type ClientToHost =
  | { type: "hello"; role: ClientRole; deviceId: string; name: string }
  | { type: "send-text"; id: string; text: string }
  | { type: "cancel"; id: string };

export type HostToClient =
  | { type: "ready"; self: DeviceInfo; snapshot: HostSnapshot }
  | { type: "snapshot"; snapshot: HostSnapshot }
  | { type: "message"; message: ChatMessage }
  | { type: "error"; code: string; message: string };

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export const FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".msi",
  ".msp",
  ".scr",
  ".js",
  ".jse",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".hta",
  ".lnk",
  ".reg",
  ".url",
  ".apk",
];

export function isImageMediaType(mediaType: string | undefined): boolean {
  const value = (mediaType ?? "").split(";")[0]?.trim().toLowerCase();
  return IMAGE_TYPES.includes(value as (typeof IMAGE_TYPES)[number]);
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
