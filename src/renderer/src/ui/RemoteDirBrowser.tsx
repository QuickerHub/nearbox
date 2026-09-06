import { useEffect, useState } from "react";
import type { RemoteDirListing } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { Icon } from "./Icons";

interface RemoteDirBrowserProps {
  client: ClientHandle;
  deviceId: string;
  deviceName: string;
  /** Where to start; empty shows the drive roots (Windows) or the home directory. */
  initialPath?: string;
  onPick(path: string): void;
  onClose(): void;
}

/**
 * A very small folder picker for a computer we only reach over ssh: one level
 * at a time, click a folder to go in, take the current one when it is right.
 */
export function RemoteDirBrowser({ client, deviceId, deviceName, initialPath, onPick, onClose }: RemoteDirBrowserProps): JSX.Element {
  const [path, setPath] = useState(initialPath ?? "");
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    client
      .listRemoteDirectory(deviceId, path)
      .then((result) => {
        if (!disposed) {
          setListing(result);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [client, deviceId, path]);

  const atTop = !listing?.path;
  const current = listing?.path ?? path;

  return (
    <div className="dir-browser" onPointerDown={(event) => event.stopPropagation()}>
      <div className="dir-browser__bar">
        <button type="button" className="icon-btn icon-btn--plain" title="上一级" disabled={atTop || loading} onClick={() => setPath(listing?.parent ?? "")}>
          <Icon name="folder-up" size={15} />
        </button>
        <span className="dir-browser__path" title={current || deviceName}>
          <Icon name="laptop" size={13} />
          <span>{current || `${deviceName} 的根目录`}</span>
        </span>
        {loading ? <span className="spinner spinner--small" /> : null}
        <button type="button" className="icon-btn icon-btn--plain" title="关闭" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="dir-browser__list">
        {error ? <p className="alert">{error}</p> : null}
        {!error && listing && atTop && listing.home ? (
          <button type="button" className="dir-browser__item" onClick={() => setPath(listing.home!)}>
            <Icon name="home" size={14} />
            <span>{listing.home}</span>
          </button>
        ) : null}
        {!error && listing && atTop && listing.roots?.length
          ? listing.roots.map((root) => (
              <button key={root} type="button" className="dir-browser__item" onClick={() => setPath(root)}>
                <Icon name="drive" size={14} />
                <span>{root}</span>
              </button>
            ))
          : null}
        {!error && listing?.entries.map((entry) => (
          <button key={entry.path} type="button" className="dir-browser__item" onClick={() => setPath(entry.path)}>
            <Icon name="folder" size={14} />
            <span>{entry.name}</span>
          </button>
        ))}
        {!error && !loading && listing && !listing.entries.length && !(atTop && listing.roots?.length) ? (
          <p className="muted small dir-browser__empty">这里没有子目录。</p>
        ) : null}
      </div>
      <div className="dir-browser__foot">
        <button type="button" className="primary" disabled={!current || loading} onClick={() => onPick(current)}>
          <Icon name="check" size={14} />
          选择这个目录
        </button>
      </div>
    </div>
  );
}
