import type { ChatMessage } from "@shared/protocol";
import { FileIcon } from "./Icons";

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  showName: boolean;
  showDay: boolean;
  fileUrl?: string;
}

export function MessageBubble({
  message,
  mine,
  showName,
  showDay,
  fileUrl,
}: MessageBubbleProps): JSX.Element {
  const image = message.kind === "image" && fileUrl;
  return (
    <>
      {showDay ? <div className="day-sep">{formatDay(message.createdAt)}</div> : null}
      <article className={mine ? "bubble-wrap bubble-wrap--mine" : "bubble-wrap bubble-wrap--theirs"}>
        {showName && !mine ? <div className="bubble-wrap__name">{message.from.name}</div> : null}
        <div className={["bubble", mine ? "bubble--mine" : "", image ? "bubble--image" : ""].filter(Boolean).join(" ")}>
          {message.kind === "text" ? <p>{message.text}</p> : null}
          {image ? (
            <a href={fileUrl} target="_blank" rel="noreferrer">
              <img src={fileUrl} alt={message.file?.name ?? "图片"} />
            </a>
          ) : null}
          {message.kind === "file" && message.file ? (
            <a className="file-card" href={fileUrl} target="_blank" rel="noreferrer">
              <span className="file-card__icon">
                <FileIcon />
              </span>
              <span>
                <strong>{message.file.name}</strong>
                <span>{formatBytes(message.file.byteLength)}</span>
              </span>
            </a>
          ) : null}
          {message.kind !== "image" ? <div className="bubble__time">{formatTime(message.createdAt)}</div> : null}
        </div>
        {image ? <div className="bubble__time">{formatTime(message.createdAt)}</div> : null}
      </article>
    </>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const today = new Date();
  if (sameDay(date, today)) {
    return "今天";
  }
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return "昨天";
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
