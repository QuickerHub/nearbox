import { useEffect, useRef, useState } from "react";
import type { ChatMessage, HostSnapshot } from "@shared/protocol";
import { MessageBubble } from "./MessageBubble";
import { PlusIcon, SendIcon } from "./Icons";

interface ChatPaneProps {
  snapshot: HostSnapshot;
  surface: "desktop" | "phone";
  error: string | null;
  fileUrl(fileId: string): string;
  onSendText(text: string): Promise<void>;
  onUpload(file: File): Promise<void>;
}

export function ChatPane({
  snapshot,
  surface,
  error,
  fileUrl,
  onSendText,
  onUpload,
}: ChatPaneProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const peer =
    surface === "desktop"
      ? snapshot.devices.find((item) => item.role === "phone" && item.online) ??
        snapshot.devices.find((item) => item.role === "phone")
      : snapshot.devices.find((item) => item.role === "desktop");

  useEffect(() => {
    const node = scroller.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [snapshot.messages.length]);

  const resizeDraft = () => {
    const node = textRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onSendText(text);
      setDraft("");
      requestAnimationFrame(resizeDraft);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      for (const file of files) {
        await onUpload(file);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="chat"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void pickFiles(event.dataTransfer.files);
      }}
      onPaste={(event) => {
        const files = event.clipboardData?.files;
        if (files?.length) {
          event.preventDefault();
          void pickFiles(files);
        }
      }}
    >
      {surface === "desktop" ? (
        <header className="chat__head">
          <div>
            <p className="eyebrow">当前会话</p>
            <h2>{peer?.name ?? "等待手机加入"}</h2>
          </div>
          <span className={peer?.online ? "pill pill--on" : "pill"}>{peer?.online ? "可互发" : "等待连接"}</span>
        </header>
      ) : null}

      <div className="chat__thread" ref={scroller}>
        {snapshot.messages.length === 0 ? (
          <div className="empty">
            <strong>还没有消息</strong>
            <p>发一句「在吗」，或把图片、文件拖到这里。</p>
          </div>
        ) : (
          snapshot.messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              mine={message.from.role === surface}
              showName={shouldShowName(snapshot.messages, index)}
              showDay={shouldShowDay(snapshot.messages, index)}
              fileUrl={message.file ? fileUrl(message.file.id) : undefined}
            />
          ))
        )}
      </div>

      {error || localError ? <p className="alert">{localError ?? error}</p> : null}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void pickFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} title="发送文件">
          <PlusIcon />
        </button>
        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          placeholder={surface === "phone" ? "发给电脑" : "发给手机"}
          onChange={(event) => {
            setDraft(event.target.value);
            resizeDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && surface === "desktop") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="composer__send" type="submit" disabled={busy || !draft.trim()} title="发送">
          <SendIcon />
        </button>
      </form>
      {dragging ? <div className="drop-mask">放到这里发给对方</div> : null}
    </section>
  );
}

function shouldShowName(messages: ChatMessage[], index: number): boolean {
  if (index === 0) {
    return true;
  }
  return messages[index - 1]?.from.id !== messages[index]?.from.id;
}

function shouldShowDay(messages: ChatMessage[], index: number): boolean {
  if (index === 0) {
    return true;
  }
  return dayKey(messages[index - 1]?.createdAt) !== dayKey(messages[index]?.createdAt);
}

function dayKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
