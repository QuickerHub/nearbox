import { useRef, useState } from "react";
import { Icon } from "./Icons";

interface ComposerProps {
  placeholder: string;
  surface: "desktop" | "phone";
  onSubmit(text: string): Promise<void>;
  onFiles?(files: FileList | File[]): Promise<void>;
  autoFocus?: boolean;
  compact?: boolean;
  hint?: string;
}

/**
 * Chat-style input: Enter sends on desktop, Shift+Enter inserts a newline,
 * the paperclip (or paste / drop) attaches files.
 */
export function Composer({ placeholder, surface, onSubmit, onFiles, autoFocus, compact, hint }: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const resize = () => {
    const node = textRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
      setDraft("");
      requestAnimationFrame(resize);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length || !onFiles) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "composer composer--compact" : "composer"}>
      {error ? <p className="composer__error">{error}</p> : null}
      <form
        className="composer__row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onPaste={(event) => {
          const files = event.clipboardData?.files;
          if (files?.length && onFiles) {
            event.preventDefault();
            void pickFiles(files);
          }
        }}
      >
        {onFiles ? (
          <>
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
            <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} title="附件" disabled={busy}>
              <Icon name="attach" />
            </button>
          </>
        ) : null}
        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          autoFocus={autoFocus}
          placeholder={placeholder}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && surface === "desktop") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="composer__send" type="submit" disabled={busy || !draft.trim()} title="发送">
          <Icon name="send" size={16} />
        </button>
      </form>
      {hint ? <p className="composer__hint">{hint}</p> : null}
    </div>
  );
}
