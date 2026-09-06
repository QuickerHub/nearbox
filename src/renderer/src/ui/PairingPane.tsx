import { useState } from "react";
import type { HostSnapshot } from "@shared/protocol";
import { CopyIcon, FolderIcon, RefreshIcon } from "./Icons";

interface PairingPaneProps {
  snapshot: HostSnapshot;
  onRefresh(): void;
  onSelectHost(host: string): void;
  onOpenInbox(): void;
}

export function PairingPane({
  snapshot,
  onRefresh,
  onSelectHost,
  onOpenInbox,
}: PairingPaneProps): JSX.Element {
  const phones = snapshot.devices.filter((item) => item.role === "phone");
  const invite = snapshot.invite;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!invite) {
      return;
    }
    await navigator.clipboard.writeText(invite.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className="pairing">
      <div className="pairing__intro">
        <p className="eyebrow">扫码连接</p>
        <p>手机和电脑连同一 Wi-Fi，扫码或输入验证码即可互传。不经过互联网。</p>
      </div>

      <section className="qr-card">
        {invite?.qrDataUrl ? (
          <img className="qr" src={invite.qrDataUrl} alt="手机连接二维码" />
        ) : (
          <div className="qr qr--empty">没有可用的局域网地址</div>
        )}
        <div>
          <span className="label">验证码</span>
          <div className="pin-row" aria-label={`验证码 ${invite?.pin ?? ""}`}>
            {(invite?.pin ?? "------").split("").map((digit, index) => (
              <span className="pin-cell" key={`${digit}-${index}`}>
                {digit}
              </span>
            ))}
          </div>
        </div>
        <div className="qr-actions">
          <button type="button" className="ghost" onClick={onRefresh}>
            <RefreshIcon />
            刷新
          </button>
          <button type="button" className="ghost" onClick={() => void copyLink()} disabled={!invite}>
            <CopyIcon />
            {copied ? "已复制" : "复制链接"}
          </button>
        </div>
      </section>

      <label className="field">
        <span className="label">本机地址</span>
        <select
          value={snapshot.selectedHost}
          onChange={(event) => onSelectHost(event.target.value)}
          disabled={snapshot.hostAddresses.length === 0}
        >
          {snapshot.hostAddresses.length === 0 ? <option>未发现局域网地址</option> : null}
          {snapshot.hostAddresses.map((host) => (
            <option key={host} value={host}>
              {host}
            </option>
          ))}
        </select>
      </label>

      {snapshot.listenError ? <p className="alert">{snapshot.listenError}</p> : null}

      <section className="card">
        <div className="row">
          <h2>已连接设备</h2>
          <span className="muted">{phones.filter((item) => item.online).length} 在线</span>
        </div>
        {phones.length === 0 ? (
          <p className="muted">还没有手机连上来。</p>
        ) : (
          <ul className="devices">
            {phones.map((device) => (
              <li key={device.id}>
                <span className="avatar">{device.name.slice(0, 1)}</span>
                <div>
                  <strong>{device.name}</strong>
                  <p className="muted">{device.online ? "在线" : "已离开"}</p>
                </div>
                <span className={device.online ? "dot dot--on" : "dot"} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="ghost pairing__footer" onClick={onOpenInbox}>
        <FolderIcon />
        打开接收文件夹
      </button>
    </aside>
  );
}
