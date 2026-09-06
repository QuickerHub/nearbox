import { useEffect, useMemo, useRef, useState } from "react";
import type { HostSnapshot } from "@shared/protocol";
import { connectClient, pairWithPin, type ClientHandle } from "./lib/client";
import { ChatPane } from "./ui/ChatPane";
import { PairingPane } from "./ui/PairingPane";

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const clientRef = useRef<ClientHandle | null>(null);
  const [client, setClient] = useState<ClientHandle | null>(null);
  const isDesktop = Boolean(window.nearboxDesktop);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const handle = await connectClient(
          (next) => {
            if (!disposed) {
              setSnapshot(next);
              setError(null);
            }
          },
          (message) => {
            if (!disposed) {
              setError(message || null);
            }
          },
        );
        if (disposed) {
          handle.dispose();
          return;
        }
        clientRef.current = handle;
        setClient(handle);
        setSnapshot(handle.snapshot);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      disposed = true;
      clientRef.current?.dispose();
    };
  }, []);

  const onlinePhones = useMemo(
    () => (snapshot?.devices ?? []).filter((item) => item.role === "phone" && item.online),
    [snapshot],
  );

  if (!isDesktop && !snapshot && error?.includes("缺少邀请")) {
    return (
      <main className="gate">
        <div className="gate__card">
          <p className="eyebrow">Nearbox</p>
          <h1>输入电脑上的验证码</h1>
          <p className="muted">和电脑连同一 Wi-Fi，然后输入 6 位数字。</p>
          <form
            className="gate__form"
            onSubmit={(event) => {
              event.preventDefault();
              void pairWithPin(pin);
            }}
          >
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
            />
            <button type="submit" disabled={pin.length !== 6}>
              连接
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (!snapshot || !client) {
    return (
      <main className="gate">
        <div className="gate__card">
          <p className="eyebrow">Nearbox</p>
          <h1>{error ? "还连不上" : "正在打开局域网通道"}</h1>
          <p className="muted">{error ?? "电脑端会在本机拉起互传服务。"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={isDesktop ? "app app--desktop" : "app app--phone"}>
      {isDesktop ? (
        <PairingPane
          snapshot={snapshot}
          onRefresh={() => void client.refreshInvite()}
          onSelectHost={(host) => void client.setHost(host)}
          onOpenInbox={() => void client.openInbox()}
        />
      ) : (
        <header className="phone-bar">
          <div>
            <p className="eyebrow">已连上 {snapshot.hostName}</p>
            <h1>Nearbox</h1>
          </div>
          <span className={onlinePhones.length ? "pill pill--on" : "pill"}>{onlinePhones.length ? "在线" : "连接中"}</span>
        </header>
      )}
      <ChatPane
        snapshot={snapshot}
        surface={client.surface}
        fileUrl={client.fileUrl}
        error={error}
        onSendText={(text) => client.sendText(text)}
        onUpload={(file) => client.upload(file)}
      />
    </main>
  );
}
