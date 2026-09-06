import { useEffect, useRef, useState } from "react";
import type { HostSnapshot } from "@shared/protocol";
import { MessageBubble } from "./MessageBubble";

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
  const [localError, setLocalError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
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
      <header className="chat__head">
        <div>
          <p className="eyebrow">{surface === "desktop" ? "当前会话" : "和电脑互传"}</p>
          <h2>{peer?.name ?? (surface === "desktop" ? "等待手机加入" : snapshot.hostName)}</h2>
        </div>
        <span className={peer?.online ? "pill pill--on" : "pill"}>{peer?.online ? "可互发" : "等待连接"}</span>
      </header>

      <div className="chat__thread" ref={scroller}>
        {snapshot.messages.length === 0 ? (
          <div className="empty">
            <strong>还没有消息</strong>
            <p>发一句「在吗」，或把图片、文件拖进来。</p>
          </div>
        ) : (
          snapshot.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              mine={message.from.role === surface}
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
        <button type="button" className="ghost icon-btn" onClick={() => fileRef.current?.click()} title="发送文件">
          +
        </button>
        <textarea
          rows={1}
          value={draft}
          placeholder={surface === "phone" ? "发给电脑…" : "发给手机…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && surface === "desktop") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          发送
        </button>
      </form>
    </section>
  );
}
