import { useEffect, useRef, useState } from "react";
import { AGENT_LABELS, type AgentAccess, type AgentKind, type HostSnapshot, isRunActive, type Task } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { planSend, type SendAction, type SendPlan } from "../lib/plan";
import { Icon, type IconName } from "./Icons";
import { Menu, MenuDivider, MenuHeading, MenuItem } from "./Menu";

export interface ComposerChips {
  projectId: string;
  agent: AgentKind | "";
  access: AgentAccess;
}

interface ChatComposerProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  task?: Task;
  chips: ComposerChips;
  onChips(patch: Partial<ComposerChips>): void;
  onSend(plan: SendPlan, text: string): Promise<void>;
  onFiles(files: File[]): Promise<void>;
  onStop?(): void;
  /** The next message opens a new agent session instead of continuing the task's conversation. */
  fresh: boolean;
  onFresh(value: boolean): void;
  /** Short confirmation from the parent ("已记录…"), shown in place of the hint. */
  notice?: string | null;
  variant: "hero" | "dock";
  autoFocus?: boolean;
}

const SEND_ICON: Record<SendAction, IconName> = {
  capture: "send",
  note: "send",
  reply: "send",
  run: "play",
  "note-run": "send",
  "create-run": "send",
};

/**
 * The one input box in the app. The chips under the text decide where the
 * message goes (which project, which agent); the button says what will happen.
 */
export function ChatComposer({
  snapshot,
  client,
  task,
  chips,
  onChips,
  onSend,
  onFiles,
  onStop,
  fresh,
  onFresh,
  notice,
  variant,
  autoFocus,
}: ChatComposerProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const desktop = client.surface === "desktop";

  const project = snapshot.projects.find((item) => item.id === chips.projectId);
  const agentInfo = snapshot.agents.find((item) => item.kind === chips.agent);
  const activeRun = task ? snapshot.runs.find((run) => run.taskId === task.id && isRunActive(run)) : undefined;
  const latestRun = task?.latestRunId ? snapshot.runs.find((run) => run.id === task.latestRunId) : undefined;

  const plan = planSend({
    task,
    draft,
    agent: chips.agent,
    agentLabel: chips.agent ? AGENT_LABELS[chips.agent] : "",
    agentInfo,
    projectId: project ? project.id : "",
    projectName: project?.name ?? "",
    runs: snapshot.runs,
    latestRun,
    fresh,
  });

  useEffect(() => {
    setError(null);
  }, [task?.id]);

  const resize = () => {
    const node = textRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, variant === "hero" ? 240 : 180)}px`;
  };

  const submit = async () => {
    if (!plan.enabled || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSend(plan, draft.trim());
      setDraft("");
      requestAnimationFrame(resize);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      textRef.current?.focus();
    }
  };

  const pickFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onFiles(Array.from(files));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const placeholder = task
    ? !chips.agent
      ? "补充说明、贴截图…"
      : plan.action === "reply"
        ? activeRun
          ? "Agent 正在工作…现在输入的会排在这一轮之后发给它"
          : `接着和 ${AGENT_LABELS[chips.agent]} 说…`
        : "补充说明、追加要求，或者直接点右边运行…"
    : chips.agent
      ? "想让 Agent 做什么？一句话说清楚，回车就开跑"
      : "记一条想法、bug、要做的事…";

  return (
    <div className={`composer composer--${variant}${dragging ? " composer--drag" : ""}`}>
      <form
        className="composer__card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onPaste={(event) => {
          const files = event.clipboardData?.files;
          if (files?.length) {
            event.preventDefault();
            void pickFiles(files);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void pickFiles(event.dataTransfer?.files ?? null);
        }}
      >
        <textarea
          ref={textRef}
          rows={variant === "hero" ? 2 : 1}
          value={draft}
          autoFocus={autoFocus}
          placeholder={placeholder}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && desktop && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer__bar">
          <ProjectMenu snapshot={snapshot} client={client} projectId={project?.id ?? ""} onPick={(projectId) => onChips({ projectId })} />
          <AgentMenu snapshot={snapshot} agent={chips.agent} access={chips.access} onPick={(agent, access) => onChips({ agent, access })} />
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
          <button type="button" className="icon-btn icon-btn--plain composer__attach" onClick={() => fileRef.current?.click()} title="附件" disabled={busy}>
            <Icon name="attach" size={16} />
          </button>
          {activeRun && onStop ? (
            <button type="button" className="composer__stop" onClick={onStop} title="停止当前运行">
              <Icon name="stop" size={12} />
              停止
            </button>
          ) : null}
          <button className={`composer__send${plan.action === "note" || plan.action === "capture" ? " composer__send--quiet" : ""}`} type="submit" disabled={busy || !plan.enabled} title={plan.hint}>
            {busy ? <span className="spinner spinner--light" /> : <Icon name={SEND_ICON[plan.action]} size={14} />}
            <span>{plan.label}</span>
          </button>
        </div>
      </form>
      <p className={`composer__hint${error ? " composer__hint--error" : notice ? " composer__hint--notice" : ""}`}>
        <span className="composer__hint-text">
          {error ?? notice ?? plan.hint}
          {!error && !notice && plan.continuing ? (
            <button type="button" className="link-btn link-btn--muted composer__hint-link" onClick={() => onFresh(true)}>
              改为新会话
            </button>
          ) : null}
          {!error && !notice && plan.canContinue ? (
            <button type="button" className="link-btn link-btn--muted composer__hint-link" onClick={() => onFresh(false)}>
              接着上次会话
            </button>
          ) : null}
        </span>
        {desktop && !error && !notice ? <span className="composer__keys">Enter 发送 · Shift+Enter 换行</span> : null}
      </p>
    </div>
  );
}

function ProjectMenu({
  snapshot,
  client,
  projectId,
  onPick,
}: {
  snapshot: HostSnapshot;
  client: ClientHandle;
  projectId: string;
  onPick(projectId: string): void;
}): JSX.Element {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = window.nearboxDesktop;
  const project = snapshot.projects.find((item) => item.id === projectId);
  const projects = [...snapshot.projects].sort(
    (a, b) => Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt),
  );

  const add = async (candidate: string, close: () => void) => {
    const value = candidate.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await client.addProject({ path: value });
      onPick(created.id);
      setPath("");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      icon="folder"
      label={project ? project.name : projects.length ? "选择项目" : "添加项目目录"}
      title={project ? project.path : "Agent 会在这个目录里工作"}
      tone={project ? "default" : "muted"}
    >
      {(close) => (
        <>
          <MenuHeading>项目目录</MenuHeading>
          {projects.map((item) => (
            <MenuItem
              key={item.id}
              icon="folder"
              label={item.name}
              sub={item.path}
              on={item.id === projectId}
              onClick={() => {
                onPick(item.id);
                close();
              }}
            />
          ))}
          {projects.length ? <MenuDivider /> : null}
          <div className="menu__form">
            {desktop ? (
              <button
                type="button"
                className="ghost menu__pick"
                disabled={busy}
                onClick={() => {
                  void desktop.pickFolder().then((chosen) => (chosen ? add(chosen, close) : undefined));
                }}
              >
                <Icon name="plus" size={14} />
                选择文件夹…
              </button>
            ) : null}
            <form
              className="menu__form-row"
              onSubmit={(event) => {
                event.preventDefault();
                void add(path, close);
              }}
            >
              <input
                value={path}
                placeholder={desktop ? "或粘贴路径，如 D:\\source\\my-app" : "电脑上的目录路径，如 D:\\source\\my-app"}
                onChange={(event) => setPath(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
              />
              <button type="submit" className="ghost" disabled={busy || !path.trim()}>
                添加
              </button>
            </form>
            {error ? <p className="alert">{error}</p> : null}
          </div>
        </>
      )}
    </Menu>
  );
}

function AgentMenu({
  snapshot,
  agent,
  access,
  onPick,
}: {
  snapshot: HostSnapshot;
  agent: AgentKind | "";
  access: AgentAccess;
  onPick(agent: AgentKind | "", access: AgentAccess): void;
}): JSX.Element {
  const label = agent ? `${AGENT_LABELS[agent]}${access === "full" ? " · 完全放开" : ""}` : "只记录";
  const anyAvailable = snapshot.agents.some((item) => item.available);
  const defaultAccess = (kind: AgentKind): AgentAccess => snapshot.settings.agents[kind]?.access ?? "safe";
  return (
    <Menu icon={agent ? "bolt" : "edit"} label={label} tone={agent ? (access === "full" ? "warn" : "default") : "muted"} title="谁来执行">
      {(close) => (
        <>
          <MenuHeading>交给谁</MenuHeading>
          <MenuItem
            icon="edit"
            label="只记录"
            sub="存成任务或备注，不运行"
            on={!agent}
            onClick={() => {
              onPick("", "safe");
              close();
            }}
          />
          {snapshot.agents.map((info) => (
            <MenuItem
              key={info.kind}
              icon="bolt"
              label={AGENT_LABELS[info.kind]}
              sub={info.available ? undefined : "未安装"}
              on={info.kind === agent}
              disabled={!info.available}
              onClick={() => {
                onPick(info.kind, info.kind === agent ? access : defaultAccess(info.kind));
                close();
              }}
            />
          ))}
          {!anyAvailable ? <p className="menu__note">这台电脑上没检测到 Agent CLI。装好 cursor-agent / codex / claude 之一后，到设置里点「重新检测」。</p> : null}
          {agent ? (
            <>
              <MenuDivider />
              <MenuHeading>权限</MenuHeading>
              <div className="menu__segment">
                <button type="button" className={access === "safe" ? "menu__seg menu__seg--on" : "menu__seg"} onClick={() => onPick(agent, "safe")}>
                  安全模式
                  <span>只改项目内文件，危险命令会被拦</span>
                </button>
                <button type="button" className={access === "full" ? "menu__seg menu__seg--on menu__seg--warn" : "menu__seg"} onClick={() => onPick(agent, "full")}>
                  完全放开
                  <span>任何命令直接执行</span>
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}
