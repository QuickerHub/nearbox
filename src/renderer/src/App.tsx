import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_LABELS, type AgentAccess, type AgentKind, type HostSnapshot, isRunActive, splitCapture, type Task } from "@shared/protocol";
import { connectClient, pairWithPin, type ClientHandle } from "./lib/client";
import type { SendAction } from "./lib/plan";
import { useRoute } from "./lib/router";
import { applyTheme, cycleTheme, readThemeMode, themeLabel, type ThemeMode } from "./theme";
import { ChatComposer, type ComposerChips } from "./ui/ChatComposer";
import { Icon, ThemeIcon } from "./ui/Icons";
import { SettingsView } from "./ui/SettingsView";
import { TaskList } from "./ui/TaskList";
import { Thread } from "./ui/Thread";

const PREFS_KEY = "nearbox.compose";

/** What this device last picked in the composer. `agent: null` means "never chose", so we default to the first installed one. */
interface ComposePrefs {
  projectId: string;
  agent: AgentKind | "" | null;
}

function readPrefs(): ComposePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ComposePrefs>;
      return { projectId: typeof parsed.projectId === "string" ? parsed.projectId : "", agent: parsed.agent === undefined ? null : parsed.agent };
    }
  } catch {
    // fall through to defaults
  }
  return { projectId: "", agent: null };
}

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [fatal, setFatal] = useState<{ message: string; code?: string } | null>(null);
  const [pin, setPin] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [client, setClient] = useState<ClientHandle | null>(null);
  const clientRef = useRef<ClientHandle | null>(null);
  const { route, navigate } = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefsState] = useState<ComposePrefs>(() => readPrefs());
  const [accessOverride, setAccessOverride] = useState<{ agent: AgentKind; access: AgentAccess } | null>(null);
  // Chip picks on an open task are patched to the server; this keeps the chip on the new value until the snapshot catches up.
  const [taskOverride, setTaskOverride] = useState<{ taskId: string; agent?: AgentKind | ""; projectId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const isDesktop = Boolean(window.nearboxDesktop);

  const setPrefs = useCallback((patch: Partial<ComposePrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(readThemeMode());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themeMode]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const handle = await connectClient(
          (next) => {
            if (!disposed) {
              setSnapshot(next);
            }
          },
          (message) => {
            if (!disposed) {
              setStatus(message);
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
          setFatal({ message: err instanceof Error ? err.message : String(err), code: (err as { code?: string }).code });
        }
      }
    })();
    return () => {
      disposed = true;
      clientRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!window.nearboxDesktop) {
      return;
    }
    return window.nearboxDesktop.onNavigate((hash) => navigate(hash));
  }, [navigate]);

  // Old-style links: a run opens its task; "#/settings" opens the modal.
  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (route.name === "run") {
      const run = snapshot.runs.find((item) => item.id === route.id);
      navigate(run ? { name: "task", id: run.taskId } : { name: "home" }, true);
    } else if (route.name === "settings") {
      setSettingsOpen(true);
      navigate({ name: "home" }, true);
    }
  }, [route, snapshot, navigate]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const active = snapshot.runs.filter(isRunActive).length;
    document.title = active ? `(${active}) Nearbox` : "Nearbox";
  }, [snapshot]);

  const onCycleTheme = () => {
    const next = cycleTheme(themeMode);
    setThemeMode(next);
    applyTheme(next);
  };

  const task: Task | undefined = route.name === "task" && snapshot ? snapshot.tasks.find((item) => item.id === route.id) : undefined;

  const chips = useMemo<ComposerChips>(() => {
    if (!snapshot) {
      return { projectId: "", agent: "", access: "safe" };
    }
    const available = snapshot.agents.filter((item) => item.available).map((item) => item.kind);
    const validAgent = (value: AgentKind | "" | null | undefined): value is AgentKind => Boolean(value) && available.includes(value as AgentKind);
    const validProject = (value: string | undefined) => Boolean(value) && snapshot.projects.some((item) => item.id === value);
    const recentProject = [...snapshot.projects].sort(
      (a, b) => Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt),
    )[0]?.id;
    const override = task && taskOverride?.taskId === task.id ? taskOverride : null;
    const agentPick = override?.agent !== undefined ? override.agent : task?.agent;
    const projectPick = override?.projectId !== undefined ? override.projectId : task?.projectId;
    const agent: AgentKind | "" =
      override?.agent === ""
        ? ""
        : validAgent(agentPick)
          ? agentPick
          : prefs.agent === null
            ? available[0] ?? ""
            : validAgent(prefs.agent)
              ? prefs.agent
              : "";
    const projectId = validProject(projectPick) ? projectPick! : validProject(prefs.projectId) ? prefs.projectId : recentProject ?? "";
    const access: AgentAccess = agent
      ? accessOverride?.agent === agent
        ? accessOverride.access
        : snapshot.settings.agents[agent]?.access ?? "safe"
      : "safe";
    return { projectId, agent, access };
  }, [snapshot, task, prefs, accessOverride, taskOverride]);

  const onChips = (patch: Partial<ComposerChips>) => {
    if (!client) {
      return;
    }
    if (patch.projectId !== undefined) {
      setPrefs({ projectId: patch.projectId });
      if (task) {
        setTaskOverride((current) => ({ ...(current?.taskId === task.id ? current : {}), taskId: task.id, projectId: patch.projectId }));
        if (patch.projectId !== (task.projectId ?? "")) {
          void client.updateTask(task.id, { projectId: patch.projectId || null }).catch(() => undefined);
        }
      }
    }
    if (patch.agent !== undefined) {
      setPrefs({ agent: patch.agent });
      if (task) {
        setTaskOverride((current) => ({ ...(current?.taskId === task.id ? current : {}), taskId: task.id, agent: patch.agent }));
        if (patch.agent !== (task.agent ?? "")) {
          void client.updateTask(task.id, { agent: patch.agent || null }).catch(() => undefined);
        }
      }
    }
    if (patch.access !== undefined) {
      const agent = patch.agent ?? chips.agent;
      if (agent) {
        setAccessOverride({ agent, access: patch.access });
      }
    }
  };

  const send = async (action: SendAction, text: string) => {
    if (!client) {
      return;
    }
    const dispatchInput = { agent: chips.agent as AgentKind, projectId: chips.projectId, access: chips.access };
    switch (action) {
      case "capture": {
        const { title, details } = splitCapture(text);
        const created = await client.createTask({ title, details, status: "inbox", projectId: chips.projectId || null });
        flash(`已记录「${created.title}」，${isDesktop ? "在左侧列表里" : "在下方列表里"}。`);
        return;
      }
      case "create-run": {
        const { title, details } = splitCapture(text);
        const created = await client.createTask({ title, details, status: "todo", projectId: chips.projectId, agent: chips.agent || null });
        try {
          await client.dispatch(created.id, dispatchInput);
        } finally {
          navigate({ name: "task", id: created.id });
        }
        return;
      }
      case "note":
        await client.addNote(task!.id, text);
        return;
      case "run":
        await client.dispatch(task!.id, dispatchInput);
        return;
      case "note-run":
        await client.addNote(task!.id, text);
        await client.dispatch(task!.id, dispatchInput);
        return;
      case "reply":
        await client.replyRun(task!.latestRunId!, text);
        return;
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!client) {
      return;
    }
    for (const file of files) {
      await client.upload(file, task?.id);
    }
    if (!task) {
      flash(files.length === 1 ? `已收到「${files[0]!.name}」，存为一条任务。` : `已收到 ${files.length} 个文件。`);
    }
  };

  if (fatal?.code === "NO_INVITE" || (!isDesktop && fatal?.message.includes("邀请"))) {
    return (
      <main className="gate">
        <div className="gate__card">
          <p className="eyebrow">Nearbox</p>
          <h1>输入电脑上的验证码</h1>
          <p className="muted">和电脑连同一 Wi-Fi，然后输入电脑「设置 → 连接手机」里的 6 位数字。</p>
          <form
            className="gate__form"
            onSubmit={(event) => {
              event.preventDefault();
              pairWithPin(pin);
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
          {fatal && fatal.code !== "NO_INVITE" ? <p className="alert">{fatal.message}</p> : null}
        </div>
      </main>
    );
  }

  if (!snapshot || !client) {
    return (
      <main className="gate">
        <div className="gate__card">
          <p className="eyebrow">Nearbox</p>
          <h1>{fatal ? "还连不上" : isDesktop ? "正在启动本机服务" : "正在连接电脑"}</h1>
          <p className="muted">{fatal?.message ?? (isDesktop ? "马上就好。" : "确认手机和电脑在同一个 Wi-Fi。")}</p>
          {fatal ? (
            <button type="button" className="primary gate__retry" onClick={() => window.location.reload()}>
              重试
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const activeRun = task ? snapshot.runs.find((run) => run.taskId === task.id && isRunActive(run)) : undefined;
  const runningTasks = snapshot.tasks.filter((item) => snapshot.runs.some((run) => run.taskId === item.id && isRunActive(run)));
  const phonesOnline = snapshot.devices.filter((device) => device.role === "phone" && device.online).length;
  const goHome = () => navigate({ name: "home" });
  const openTask = (id: string) => navigate({ name: "task", id });

  const composer = (variant: "hero" | "dock") => (
    <ChatComposer
      key={task?.id ?? "home"}
      snapshot={snapshot}
      client={client}
      task={task}
      chips={chips}
      onChips={onChips}
      onSend={send}
      onFiles={uploadFiles}
      onStop={activeRun ? () => void client.cancelRun(activeRun.id) : undefined}
      notice={notice}
      variant={variant}
      autoFocus={isDesktop}
    />
  );

  const threadOrNotFound = task ? (
    <Thread key={task.id} snapshot={snapshot} client={client} task={task} onDeleted={goHome}>
      {composer("dock")}
    </Thread>
  ) : (
    <div className="home">
      <div className="home__inner">
        <p className="eyebrow">这个任务不存在或已删除</p>
        <button type="button" className="ghost" onClick={goHome}>
          回到开始
        </button>
      </div>
    </div>
  );

  const home = (
    <div className="home">
      <div className="home__inner">
        {isDesktop ? (
          <>
            <h1 className="home__title">想让 Agent 做点什么？</h1>
            <p className="home__sub muted">一句话说清楚任务，选好项目和 Agent，回车就开跑。不选 Agent 就只是记一下。</p>
          </>
        ) : null}
        {composer("hero")}
        {runningTasks.length ? (
          <div className="home__running">
            {runningTasks.map((item) => {
              const run = snapshot.runs.find((candidate) => candidate.taskId === item.id && isRunActive(candidate))!;
              return (
                <button key={item.id} type="button" className="home__running-item" onClick={() => openTask(item.id)}>
                  <span className="spinner spinner--small" />
                  <span className="home__running-title">{item.title}</span>
                  <span className="muted small">
                    {AGENT_LABELS[run.agent]} · {run.status === "queued" ? "排队中" : "运行中"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {!isDesktop ? <TaskList snapshot={snapshot} onSelect={openTask} compact /> : null}
    </div>
  );

  const settings = settingsOpen ? (
    <SettingsView snapshot={snapshot} client={client} themeMode={themeMode} onCycleTheme={onCycleTheme} onClose={() => setSettingsOpen(false)} />
  ) : null;

  if (isDesktop) {
    return (
      <main className="app app--desktop">
        <aside className="sidebar">
          <div className="sidebar__top">
            <div className="sidebar__brand">
              <span className="chrome__mark">N</span>
              <strong>Nearbox</strong>
            </div>
            <button type="button" className={route.name === "home" ? "sidebar__new sidebar__new--on" : "sidebar__new"} onClick={goHome}>
              <Icon name="plus" size={15} />
              <span>新对话</span>
            </button>
          </div>
          <TaskList snapshot={snapshot} selectedTaskId={task?.id} onSelect={openTask} />
          <div className="sidebar__foot">
            <span className="sidebar__phones" title={snapshot.selectedHost ? `${snapshot.selectedHost}:${snapshot.port}` : "未发现局域网地址"}>
              <span className={phonesOnline ? "dot dot--on" : "dot"} />
              <span className="muted small">{phonesOnline ? `${phonesOnline} 台手机在线` : "没有手机在线"}</span>
            </span>
            <button type="button" className="icon-btn icon-btn--plain" onClick={onCycleTheme} title={themeLabel(themeMode)}>
              <ThemeIcon mode={themeMode} />
            </button>
            <button type="button" className="icon-btn icon-btn--plain" onClick={() => setSettingsOpen(true)} title="设置">
              <Icon name="settings" size={16} />
            </button>
          </div>
        </aside>
        <div className="main">
          {status ? <div className="banner">{status}</div> : null}
          {route.name === "task" ? threadOrNotFound : home}
        </div>
        {settings}
      </main>
    );
  }

  return (
    <main className="app app--phone">
      <header className="topbar">
        {route.name === "task" ? (
          <button type="button" className="icon-btn icon-btn--plain" onClick={goHome} title="返回">
            <Icon name="back" />
          </button>
        ) : (
          <span className="chrome__mark">N</span>
        )}
        <strong className="topbar__title">{task ? task.title : "Nearbox"}</strong>
        {route.name !== "task" ? <span className={phonesOnline || client.surface === "phone" ? "dot dot--on" : "dot"} title="已连上电脑" /> : null}
        <button type="button" className="icon-btn icon-btn--plain" onClick={() => setSettingsOpen(true)} title="设置">
          <Icon name="settings" size={18} />
        </button>
      </header>
      {status ? <div className="banner">{status}</div> : null}
      <div className="main">{route.name === "task" ? threadOrNotFound : home}</div>
      {settings}
    </main>
  );
}
