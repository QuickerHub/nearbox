import { useEffect, useMemo, useRef, useState } from "react";
import { type HostSnapshot, isRunActive } from "@shared/protocol";
import { connectClient, pairWithPin, type ClientHandle } from "./lib/client";
import { type Route, type Section, sectionOf, useRoute } from "./lib/router";
import { applyTheme, cycleTheme, readThemeMode, themeLabel, type ThemeMode } from "./theme";
import { Icon, type IconName, ThemeIcon } from "./ui/Icons";
import { InboxView } from "./ui/InboxView";
import { ProjectsView } from "./ui/ProjectsView";
import { RunView } from "./ui/RunView";
import { RunsView } from "./ui/RunsView";
import { SettingsView } from "./ui/SettingsView";
import { TaskDetail } from "./ui/TaskDetail";
import { TaskListView } from "./ui/TaskListView";
import { EmptyState } from "./ui/bits";

const NAV: { section: Section; label: string; icon: IconName; route: Route }[] = [
  { section: "inbox", label: "收集箱", icon: "inbox", route: { name: "inbox" } },
  { section: "tasks", label: "任务", icon: "tasks", route: { name: "tasks", status: "all" } },
  { section: "runs", label: "Agent", icon: "bolt", route: { name: "runs" } },
  { section: "projects", label: "项目", icon: "folder", route: { name: "projects" } },
  { section: "settings", label: "设置", icon: "settings", route: { name: "settings" } },
];

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [fatal, setFatal] = useState<{ message: string; code?: string } | null>(null);
  const [pin, setPin] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [client, setClient] = useState<ClientHandle | null>(null);
  const clientRef = useRef<ClientHandle | null>(null);
  const { route, navigate, back } = useRoute();
  const [lastList, setLastList] = useState<"inbox" | "tasks">("inbox");
  const isDesktop = Boolean(window.nearboxDesktop);

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
    if (route.name === "inbox" || route.name === "tasks") {
      setLastList(route.name);
    }
  }, [route]);

  useEffect(() => {
    if (!window.nearboxDesktop) {
      return;
    }
    return window.nearboxDesktop.onNavigate((hash) => navigate(hash));
  }, [navigate]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const active = snapshot.runs.filter(isRunActive).length;
    document.title = active ? `(${active}) Nearbox` : "Nearbox";
  }, [snapshot]);

  const counts = useMemo(() => {
    const inbox = snapshot?.tasks.filter((task) => task.status === "inbox").length ?? 0;
    const open = snapshot?.tasks.filter((task) => task.status === "todo" || task.status === "doing").length ?? 0;
    const runs = snapshot?.runs.filter(isRunActive).length ?? 0;
    return { inbox, tasks: open, runs, projects: 0, settings: 0 } as Record<Section, number>;
  }, [snapshot]);

  const onCycleTheme = () => {
    const next = cycleTheme(themeMode);
    setThemeMode(next);
    applyTheme(next);
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

  const section = sectionOf(route);
  const selectedTask = route.name === "task" ? snapshot.tasks.find((task) => task.id === route.id) : undefined;
  const selectedRun = route.name === "run" ? snapshot.runs.find((run) => run.id === route.id) : undefined;
  const openTask = (id: string) => navigate({ name: "task", id });
  const openRun = (id: string) => navigate({ name: "run", id });
  const goProjects = () => navigate({ name: "projects" });

  const taskDetail = (embedded: boolean) =>
    selectedTask ? (
      <TaskDetail
        key={selectedTask.id}
        snapshot={snapshot}
        client={client}
        task={selectedTask}
        embedded={embedded}
        onBack={() => (isDesktop ? navigate(lastList === "inbox" ? { name: "inbox" } : { name: "tasks", status: "all" }) : back())}
        onOpenRun={openRun}
        onManageProjects={goProjects}
      />
    ) : (
      <NotFound label="这个任务不存在或已删除" onBack={() => navigate({ name: "tasks", status: "all" })} />
    );

  const runDetail = (embedded: boolean) =>
    selectedRun ? (
      <RunView
        key={selectedRun.id}
        snapshot={snapshot}
        client={client}
        run={selectedRun}
        embedded={embedded}
        onBack={() => (isDesktop ? navigate({ name: "runs" }) : back())}
        onOpenTask={openTask}
        onOpenRun={openRun}
      />
    ) : (
      <NotFound label="找不到这次运行" onBack={() => navigate({ name: "runs" })} />
    );

  const listFor = (which: "inbox" | "tasks") =>
    which === "inbox" ? (
      <InboxView snapshot={snapshot} client={client} selectedTaskId={selectedTask?.id} onOpenTask={openTask} />
    ) : (
      <TaskListView
        snapshot={snapshot}
        client={client}
        filter={route.name === "tasks" ? route.status : "all"}
        selectedTaskId={selectedTask?.id}
        onFilter={(statusFilter) => navigate({ name: "tasks", status: statusFilter }, true)}
        onOpenTask={openTask}
      />
    );

  const settingsView = <SettingsView snapshot={snapshot} client={client} themeMode={themeMode} onCycleTheme={onCycleTheme} />;

  if (isDesktop) {
    const listSection: "inbox" | "tasks" | null =
      route.name === "inbox" ? "inbox" : route.name === "tasks" ? "tasks" : route.name === "task" ? lastList : null;
    return (
      <main className="app app--desktop">
        <nav className="sidebar">
          <div className="sidebar__brand">
            <span className="chrome__mark">N</span>
            <div>
              <strong>Nearbox</strong>
              <p className="muted small">
                {snapshot.selectedHost ? `${snapshot.selectedHost}:${snapshot.port}` : "未发现局域网地址"}
              </p>
            </div>
          </div>
          {NAV.map((item) => (
            <button
              key={item.section}
              type="button"
              className={item.section === section ? "nav-item nav-item--on" : "nav-item"}
              onClick={() => navigate(item.route)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {counts[item.section] ? <span className={item.section === "runs" ? "nav-count nav-count--live" : "nav-count"}>{counts[item.section]}</span> : null}
            </button>
          ))}
          <div className="sidebar__foot">
            <div className="sidebar__phones">
              <span className={snapshot.devices.some((d) => d.role === "phone" && d.online) ? "dot dot--on" : "dot"} />
              <span className="muted small">
                {(() => {
                  const online = snapshot.devices.filter((d) => d.role === "phone" && d.online).length;
                  return online ? `${online} 台手机在线` : "没有手机在线";
                })()}
              </span>
            </div>
            <button type="button" className="theme-btn" onClick={onCycleTheme} title={themeLabel(themeMode)}>
              <ThemeIcon mode={themeMode} />
            </button>
          </div>
        </nav>

        {status ? <div className="banner">{status}</div> : null}

        <div className={(listSection && route.name === "task") || (section === "runs" && route.name === "run") ? "workspace workspace--split" : "workspace"}>
          {listSection ? (
            route.name === "task" ? (
              <>
                <div className="pane pane--list">{listFor(listSection)}</div>
                <div className="pane pane--detail">{taskDetail(true)}</div>
              </>
            ) : (
              <div className="pane pane--wide">{listFor(listSection)}</div>
            )
          ) : section === "runs" ? (
            route.name === "run" ? (
              <>
                <div className="pane pane--list">
                  <RunsView snapshot={snapshot} selectedRunId={selectedRun?.id} onOpenRun={openRun} />
                </div>
                <div className="pane pane--detail">{runDetail(true)}</div>
              </>
            ) : (
              <div className="pane pane--wide">
                <RunsView snapshot={snapshot} selectedRunId={selectedRun?.id} onOpenRun={openRun} />
              </div>
            )
          ) : section === "projects" ? (
            <div className="pane pane--single">
              <ProjectsView snapshot={snapshot} client={client} />
            </div>
          ) : (
            <div className="pane pane--single">{settingsView}</div>
          )}
        </div>
      </main>
    );
  }

  const detailRoute = route.name === "task" || route.name === "run";
  return (
    <main className="app app--phone">
      {status ? <div className="banner">{status}</div> : null}
      <div className="phone-body">
        {route.name === "task"
          ? taskDetail(false)
          : route.name === "run"
            ? runDetail(false)
            : section === "inbox"
              ? listFor("inbox")
              : section === "tasks"
                ? listFor("tasks")
                : section === "runs"
                  ? <RunsView snapshot={snapshot} onOpenRun={openRun} />
                  : section === "projects"
                    ? <ProjectsView snapshot={snapshot} client={client} />
                    : settingsView}
      </div>
      {!detailRoute ? (
        <nav className="tabbar">
          {NAV.map((item) => (
            <button
              key={item.section}
              type="button"
              className={item.section === section ? "tab tab--on" : "tab"}
              onClick={() => navigate(item.route)}
            >
              <span className="tab__icon">
                <Icon name={item.icon} size={20} />
                {counts[item.section] ? <span className="tab__badge">{counts[item.section]}</span> : null}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </main>
  );
}

function NotFound({ label, onBack }: { label: string; onBack(): void }): JSX.Element {
  return (
    <section className="screen">
      <EmptyState
        title={label}
        action={
          <button type="button" className="ghost" onClick={onBack}>
            返回列表
          </button>
        }
      />
    </section>
  );
}
