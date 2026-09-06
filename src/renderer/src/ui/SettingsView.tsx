import { useEffect, useState } from "react";
import { AGENT_KINDS, AGENT_LABELS, type AgentKind, type HostSnapshot } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { formatRelative } from "../lib/format";
import { type ThemeMode, themeLabel } from "../theme";
import { Icon, ThemeIcon } from "./Icons";
import { ProjectsBlock } from "./ProjectsBlock";

interface SettingsViewProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  themeMode: ThemeMode;
  onCycleTheme(): void;
  onClose(): void;
}

/** Settings live in a modal over the conversation; Escape or the backdrop closes it. */
export function SettingsView({ snapshot, client, themeMode, onCycleTheme, onClose }: SettingsViewProps): JSX.Element {
  const desktop = client.surface === "desktop";
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const invite = snapshot.invite;
  const phones = snapshot.devices.filter((device) => device.role === "phone");
  const settings = snapshot.settings;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const patchAgent = (kind: AgentKind, patch: Partial<{ access: "safe" | "full"; model: string; command: string }>) => {
    const current = settings.agents[kind] ?? { access: "safe" as const };
    void client.updateSettings({ agents: { [kind]: { ...current, ...patch } } });
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section className="modal settings" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="设置">
        <header className="modal__head">
          <h2>设置</h2>
          <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} title="关闭">
            <Icon name="close" />
          </button>
        </header>
      <div className="modal__body settings__scroll">
        {desktop ? (
          <section className="settings__block">
            <div className="settings__block-head">
              <h2>连接手机</h2>
              <p className="muted">手机打开 Nearbox 会自动发现这台电脑，点一下即可配对；也可以扫码。不经过互联网。</p>
            </div>
            <div className="pair-grid">
              <div className="qr-card">
                {invite?.qrDataUrl ? (
                  <img className="qr" src={invite.qrDataUrl} alt="手机连接二维码" />
                ) : (
                  <div className="qr qr--empty">没有可用的局域网地址</div>
                )}
                <div className="pin-row" aria-label={`验证码 ${invite?.pin ?? ""}`}>
                  {(invite?.pin ?? "------").split("").map((digit, index) => (
                    <span className="pin-cell" key={`${digit}-${index}`}>
                      {digit}
                    </span>
                  ))}
                </div>
                <div className="qr-actions">
                  <button type="button" className="ghost" onClick={() => void client.refreshInvite()}>
                    <Icon name="refresh" size={14} />
                    换一个
                  </button>
                  <button type="button" className="ghost" disabled={!invite} onClick={() => invite && void copy("link", invite.url)}>
                    <Icon name="copy" size={14} />
                    {copied === "link" ? "已复制" : "复制链接"}
                  </button>
                </div>
              </div>
              <div className="pair-side">
                <label className="field">
                  <span className="label">本机地址</span>
                  <select
                    value={snapshot.selectedHost}
                    onChange={(event) => void client.setHost(event.target.value)}
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
                <div className="field">
                  <span className="label">已配对的手机</span>
                  {phones.length === 0 ? (
                    <p className="muted small">还没有手机连过来。配对一次后会一直记住，电脑重启也不用重新扫码。</p>
                  ) : (
                    <ul className="devices">
                      {phones.map((device) => (
                        <li key={device.id}>
                          <span className={device.online ? "dot dot--on" : "dot"} />
                          <div>
                            <strong>{device.name}</strong>
                            <p className="muted small">{device.online ? "在线" : `最近 ${formatRelative(device.lastSeenAt)}`}</p>
                          </div>
                          <button type="button" className="link-btn link-btn--danger" onClick={() => void client.forgetDevice(device.id)}>
                            解除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {invite?.apkUrl ? (
                  <details className="field">
                    <summary className="label">安装 Android 壳 App（可选）</summary>
                    <p className="muted small">
                      系统相机扫上面的码就能用，不装 App 也行。装了壳 App 可以从桌面直接打开。界面始终由电脑下发，更新电脑即可。
                    </p>
                    {invite.apkQrDataUrl ? <img className="qr qr--apk" src={invite.apkQrDataUrl} alt="下载 Android 安装包" /> : null}
                    <button type="button" className="ghost" onClick={() => void copy("apk", invite.apkUrl ?? "")}>
                      <Icon name="copy" size={14} />
                      {copied === "apk" ? "已复制" : "复制安装链接"}
                    </button>
                  </details>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="settings__block">
            <div className="settings__block-head">
              <h2>连接</h2>
              <p className="muted">
                已连上 {snapshot.hostName}（{snapshot.selectedHost}:{snapshot.port}）。配对会一直保留，除非在电脑上解除。
              </p>
            </div>
          </section>
        )}

        <ProjectsBlock snapshot={snapshot} client={client} />

        <section className="settings__block">
          <div className="settings__block-head">
            <h2>Agent</h2>
            <p className="muted">检测到的命令行工具，以及每个 Agent 派发时的默认权限和模型。</p>
          </div>
          <div className="agent-table">
            {AGENT_KINDS.map((kind) => {
              const info = snapshot.agents.find((item) => item.kind === kind);
              const conf = settings.agents[kind];
              return (
                <div className="agent-table__row" key={kind}>
                  <div className="agent-table__name">
                    <span className={info?.available ? "dot dot--on" : "dot"} />
                    <strong>{AGENT_LABELS[kind]}</strong>
                    <span className="muted small agent-table__cmd" title={info?.command}>
                      {info?.available ? info.command : info?.detail ?? "未检测"}
                    </span>
                  </div>
                  <div className="agent-table__controls">
                    <select value={conf?.access ?? "safe"} onChange={(event) => patchAgent(kind, { access: event.target.value as "safe" | "full" })}>
                      <option value="safe">默认安全模式</option>
                      <option value="full">默认完全放开</option>
                    </select>
                    <input
                      key={`${kind}-model-${conf?.model ?? ""}`}
                      defaultValue={conf?.model ?? ""}
                      placeholder="默认模型"
                      onBlur={(event) => {
                        if ((event.target.value ?? "") !== (conf?.model ?? "")) {
                          patchAgent(kind, { model: event.target.value });
                        }
                      }}
                    />
                    {desktop ? (
                      <input
                        key={`${kind}-cmd-${conf?.command ?? ""}`}
                        defaultValue={conf?.command ?? ""}
                        placeholder="命令路径（留空自动查找）"
                        onBlur={(event) => {
                          if ((event.target.value ?? "") !== (conf?.command ?? "")) {
                            patchAgent(kind, { command: event.target.value });
                            void client.refreshAgents();
                          }
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="ghost"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void client.refreshAgents().finally(() => setRefreshing(false));
            }}
          >
            <Icon name="refresh" size={14} />
            {refreshing ? "检测中…" : "重新检测"}
          </button>
        </section>

        <section className="settings__block">
          <div className="settings__block-head">
            <h2>运行</h2>
          </div>
          <label className="setting-row">
            <span>
              <strong>同时运行的 Agent 数</strong>
              <span className="muted small">同一个项目始终只跑一个；这是不同项目之间的上限。</span>
            </span>
            <select value={settings.maxConcurrentRuns} onChange={(event) => void client.updateSettings({ maxConcurrentRuns: Number(event.target.value) })}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {desktop ? (
            <>
              <label className="setting-row">
                <span>
                  <strong>运行结束时弹系统通知</strong>
                </span>
                <input type="checkbox" checked={settings.notifyOnRunFinish} onChange={(event) => void client.updateSettings({ notifyOnRunFinish: event.target.checked })} />
              </label>
              <label className="setting-row">
                <span>
                  <strong>关闭窗口时缩到托盘</strong>
                  <span className="muted small">手机随时能连上来派任务。彻底退出请用托盘菜单。</span>
                </span>
                <input type="checkbox" checked={settings.closeToTray} onChange={(event) => void client.updateSettings({ closeToTray: event.target.checked })} />
              </label>
              <label className="setting-row">
                <span>
                  <strong>开机自动启动（后台）</strong>
                </span>
                <input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => void client.updateSettings({ launchAtLogin: event.target.checked })} />
              </label>
            </>
          ) : null}
        </section>

        <section className="settings__block">
          <div className="settings__block-head">
            <h2>外观与关于</h2>
          </div>
          <div className="setting-row">
            <span>
              <strong>主题</strong>
            </span>
            <button type="button" className="ghost" onClick={onCycleTheme}>
              <ThemeIcon mode={themeMode} />
              {themeLabel(themeMode)}
            </button>
          </div>
          <div className="setting-row">
            <span>
              <strong>Nearbox v{snapshot.appVersion}</strong>
              <span className="muted small">数据目录：{snapshot.dataDir}</span>
            </span>
            {desktop ? (
              <button type="button" className="ghost" onClick={() => void window.nearboxDesktop?.openPath(snapshot.dataDir)}>
                <Icon name="folder" size={14} />
                打开
              </button>
            ) : null}
          </div>
          <div className="setting-row">
            <span>
              <strong>接收的文件</strong>
              <span className="muted small">{snapshot.inboxDir}</span>
            </span>
            {desktop ? (
              <button type="button" className="ghost" onClick={() => void window.nearboxDesktop?.openPath(snapshot.inboxDir)}>
                <Icon name="folder" size={14} />
                打开
              </button>
            ) : null}
          </div>
        </section>
      </div>
      </section>
    </div>
  );
}
