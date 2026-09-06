import type { ChatMessage } from "@shared/protocol";

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  fileUrl?: string;
}

export function MessageBubble({ message, mine, fileUrl }: MessageBubbleProps): JSX.Element {
  return (
    <article className={mine ? "bubble bubble--mine" : "bubble"}>
      <header>
        <span>{message.from.name}</span>
        <time>{formatTime(message.createdAt)}</time>
      </header>
      {message.kind === "text" ? <p>{message.text}</p> : null}
      {message.kind === "image" && fileUrl ? (
        <a href={fileUrl} target="_blank" rel="noreferrer">
          <img src={fileUrl} alt={message.file?.name ?? "图片"} />
        </a>
      ) : null}
      {message.kind === "file" && message.file ? (
        <a className="file-card" href={fileUrl} target="_blank" rel="noreferrer">
          <strong>{message.file.name}</strong>
          <span>{formatBytes(message.file.byteLength)}</span>
        </a>
      ) : null}
    </article>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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
