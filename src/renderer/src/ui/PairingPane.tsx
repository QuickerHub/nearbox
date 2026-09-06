import type { HostSnapshot } from "@shared/protocol";

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

  return (
    <aside className="pairing">
      <div className="pairing__brand">
        <p className="eyebrow">局域网互传</p>
        <h1>Nearbox</h1>
        <p className="muted">手机扫码即可和这台电脑互发消息、图片和文件。不经过互联网。</p>
      </div>

      <section className="card qr-card">
        {invite?.qrDataUrl ? (
          <img className="qr" src={invite.qrDataUrl} alt="手机连接二维码" />
        ) : (
          <div className="qr qr--empty">打不开局域网</div>
        )}
        <div className="qr-meta">
          <div>
            <span className="label">验证码</span>
            <strong className="pin">{invite?.pin ?? "------"}</strong>
          </div>
          <button type="button" className="ghost" onClick={onRefresh}>
            刷新邀请
          </button>
        </div>
        {invite ? (
          <button
            type="button"
            className="linkish"
            onClick={() => void navigator.clipboard.writeText(invite.url)}
          >
            复制链接 {invite.host}:{invite.port}
          </button>
        ) : null}
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
          <p className="muted">还没有手机连上来。扫上面的码即可。</p>
        ) : (
          <ul className="devices">
            {phones.map((device) => (
              <li key={device.id}>
                <span className={device.online ? "dot dot--on" : "dot"} />
                <div>
                  <strong>{device.name}</strong>
                  <p className="muted">{device.online ? "在线" : "已离开"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="ghost" onClick={onOpenInbox}>
        打开接收文件夹
      </button>
    </aside>
  );
}
