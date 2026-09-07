import type { LucideIcon, LucideProps } from "lucide-react";
import {
  ArrowLeft,
  Ban,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  Copy,
  ExternalLink,
  File,
  FilePen,
  FilePlus,
  FileText,
  FileX,
  Flag,
  Folder,
  FolderOpen,
  FolderSearch,
  FolderUp,
  Globe,
  HardDrive,
  Home,
  Inbox,
  Keyboard,
  Laptop,
  ListChecks,
  ListTodo,
  Monitor,
  Moon,
  MoreHorizontal,
  Mouse,
  MousePointerClick,
  Paperclip,
  Pencil,
  Play,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  Sun,
  SunMoon,
  Terminal,
  TextSearch,
  Trash2,
  Wrench,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ThemeMode } from "../theme";
import type { ToolKind } from "@shared/protocol";

export type IconName =
  | "inbox"
  | "tasks"
  | "bolt"
  | "folder"
  | "settings"
  | "back"
  | "trash"
  | "play"
  | "stop"
  | "send"
  | "plus"
  | "chevron"
  | "phone"
  | "refresh"
  | "copy"
  | "file"
  | "flag"
  | "check"
  | "circle"
  | "dots"
  | "external"
  | "search"
  | "close"
  | "attach"
  | "sun"
  | "moon"
  | "auto"
  | "edit"
  | "reply"
  | "terminal"
  | "monitor"
  | "keyboard"
  | "file-text"
  | "file-pen"
  | "file-plus"
  | "file-x"
  | "folder-search"
  | "folder-open"
  | "text-search"
  | "globe"
  | "bot"
  | "list-checks"
  | "plug"
  | "wrench"
  | "brain"
  | "ban"
  | "alert"
  | "restart"
  | "laptop"
  | "radar"
  | "folder-up"
  | "home"
  | "drive"
  | "sparkles"
  | "zoom-in"
  | "zoom-out"
  | "mouse"
  | "click"
  | "chevron-up"
  | "chevron-down";

const ICONS: Record<IconName, LucideIcon> = {
  inbox: Inbox,
  tasks: ListTodo,
  bolt: Zap,
  folder: Folder,
  settings: Settings,
  back: ArrowLeft,
  trash: Trash2,
  play: Play,
  stop: Square,
  send: Send,
  plus: Plus,
  chevron: ChevronRight,
  phone: Smartphone,
  refresh: RefreshCw,
  copy: Copy,
  file: File,
  flag: Flag,
  check: Check,
  circle: Circle,
  dots: MoreHorizontal,
  external: ExternalLink,
  search: Search,
  close: X,
  attach: Paperclip,
  sun: Sun,
  moon: Moon,
  auto: SunMoon,
  edit: Pencil,
  reply: Reply,
  terminal: Terminal,
  "file-text": FileText,
  "file-pen": FilePen,
  "file-plus": FilePlus,
  "file-x": FileX,
  "folder-search": FolderSearch,
  "folder-open": FolderOpen,
  "text-search": TextSearch,
  globe: Globe,
  bot: Bot,
  "list-checks": ListChecks,
  plug: Plug,
  wrench: Wrench,
  brain: Brain,
  ban: Ban,
  alert: CircleAlert,
  restart: RotateCcw,
  monitor: Monitor,
  keyboard: Keyboard,
  laptop: Laptop,
  radar: Radar,
  "folder-up": FolderUp,
  home: Home,
  drive: HardDrive,
  sparkles: Sparkles,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  mouse: Mouse,
  click: MousePointerClick,
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,
};

export const TOOL_ICONS: Record<ToolKind, IconName> = {
  shell: "terminal",
  read: "file-text",
  edit: "file-pen",
  write: "file-plus",
  delete: "file-x",
  glob: "folder-search",
  grep: "text-search",
  ls: "folder-open",
  web: "globe",
  task: "bot",
  todo: "list-checks",
  mcp: "plug",
  other: "wrench",
};

export function Icon({
  name,
  size = 18,
  className,
  style,
  ...rest
}: { name: IconName; size?: number } & Omit<LucideProps, "ref" | "size">): JSX.Element {
  const Glyph = ICONS[name];
  return (
    <span className={["icon", className].filter(Boolean).join(" ")} style={{ width: size, height: size }} aria-hidden>
      <Glyph size={size} strokeWidth={1.75} absoluteStrokeWidth style={style} {...rest} />
    </span>
  );
}

export function ThemeIcon({ mode }: { mode: ThemeMode }): JSX.Element {
  return <Icon name={mode === "light" ? "sun" : mode === "dark" ? "moon" : "auto"} size={16} />;
}
