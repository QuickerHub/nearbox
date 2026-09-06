import { useEffect, useState } from "react";
import { type FileMeta, isImageFile } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatBytes } from "../lib/format";
import { Icon } from "./Icons";

interface LightboxProps {
  src: string;
  name: string;
  /** Where the original can be opened in a new tab; omitted for local blobs still in the composer. */
  href?: string;
  onClose(): void;
}

/** Full-size view of one picture. Click outside or press Esc to close. */
export function Lightbox({ src, name, href, onClose }: LightboxProps): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-label={name} onClick={onClose}>
      <div className="lightbox__bar" onClick={(event) => event.stopPropagation()}>
        <span className="lightbox__name" title={name}>
          {name}
        </span>
        {href ? (
          <a className="icon-btn icon-btn--plain lightbox__btn" href={href} target="_blank" rel="noreferrer" title="在新窗口打开">
            <Icon name="external" size={16} />
          </a>
        ) : null}
        <button type="button" className="icon-btn icon-btn--plain lightbox__btn" onClick={onClose} title="关闭">
          <Icon name="close" size={18} />
        </button>
      </div>
      <img className="lightbox__img" src={src} alt={name} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

interface FileStripProps {
  files: readonly FileMeta[];
  client: ClientHandle;
}

/**
 * The files of one message: pictures as a row of thumbnails (one picture gets
 * room to breathe), everything else as a card that opens the file.
 */
export function FileStrip({ files, client }: FileStripProps): JSX.Element | null {
  const [preview, setPreview] = useState<FileMeta | null>(null);
  const images = files.filter(isImageFile);
  const others = files.filter((file) => !isImageFile(file));
  if (!files.length) {
    return null;
  }
  return (
    <>
      {images.length ? (
        <div className={`media${images.length === 1 ? " media--single" : ""}`}>
          {images.map((file) => (
            <button key={file.id} type="button" className="media__item" onClick={() => setPreview(file)} title={file.name}>
              <img src={client.fileUrl(file.id)} alt={file.name} loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      {others.map((file) => (
        <a key={file.id} className="file-card" href={client.fileUrl(file.id)} target="_blank" rel="noreferrer">
          <span className="file-card__icon">
            <Icon name="file" size={18} />
          </span>
          <span>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.byteLength)}</span>
          </span>
        </a>
      ))}
      {preview ? <Lightbox src={client.fileUrl(preview.id)} name={preview.name} href={client.fileUrl(preview.id)} onClose={() => setPreview(null)} /> : null}
    </>
  );
}
