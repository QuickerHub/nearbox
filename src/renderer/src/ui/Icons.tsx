import type { LucideIcon, LucideProps } from "lucide-react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  File,
  Flag,
  Folder,
  Inbox,
  Keyboard,
  ListTodo,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Smartphone,
  Square,
  SunMoon,
  Sun,
  Moon,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { ThemeMode } from "../theme";

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
  | "keyboard";

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
  monitor: Monitor,
  keyboard: Keyboard,
};

export function Icon({
  name,
  size = 18,
  className,
  ...rest
}: { name: IconName; size?: number } & Omit<LucideProps, "ref" | "size">): JSX.Element {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      absoluteStrokeWidth
      className={["icon", className].filter(Boolean).join(" ")}
      aria-hidden
      {...rest}
    />
  );
}

export function ThemeIcon({ mode }: { mode: ThemeMode }): JSX.Element {
  return <Icon name={mode === "light" ? "sun" : mode === "dark" ? "moon" : "auto"} size={16} />;
}
