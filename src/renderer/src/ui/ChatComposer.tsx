import { useEffect, useRef, useState } from "react";
import { AGENT_LABELS, type AgentAccess, type AgentKind, type FileMeta, type HostSnapshot, isRunActive, MAX_FILES_PER_MESSAGE, type Task } from "@shared/protocol";
import { type DraftAttachment, extractFiles, stageFiles, stageNotice } from "../lib/attachments";
import type { ClientHandle } from "../lib/client";
import { formatBytes } from "../lib/format";
import { planSend, type SendAction, type SendPlan } from "../lib/plan";
import { Lightbox } from "./Attachments";
import { Icon, type IconName } from "./Icons";
import { Menu, MenuDivider, MenuHeading, MenuItem } from "./Menu";

export interface ComposerChips {
  projectId: string;
  agent: AgentKind | "";
  access: AgentAccess;
}

/** One message as the user composed it: words plus the files already uploaded to the PC. */
export interface OutgoingMessage {
  text: string;
  files: FileMeta[];
}

interface ChatComposerProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  task?: Task;
  chips: ComposerChips;
  onChips(patch: Partial<ComposerChips>): void;
  onSend(plan: SendPlan, message: OutgoingMessage): Promise<void>;
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
 * Pictures pasted or dropped here wait as thumbnails above the text and go out
 * with it as one message.
 */
export function ChatComposer({
  snapshot,
  client,
  task,
  chips,
  onChips,
  onSend,
  onStop,
  fresh,
  onFresh,
  notice,
  variant,
  autoFocus,
}: ChatComposerProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [preview, setPreview] = useState<DraftAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const desktop = client.surface === "desktop";

  const project = snapshot.projects.find((item) => item.id === chips.projectId);
  const agentInfo = snapshot.agents.find((item) => item.kind === chips.agent);
  const activeRun = task ? snapshot.runs.find((run) => run.taskId === task.id && isRunActive(run)) : undefined;

  const plan = planSend({
    task,
    draft,
    attachments: attachments.length,
    agent: chips.agent,
    agentLabel: chips.agent ? AGENT_LABELS[chips.agent] : "",
    agentInfo,
    projectId: project ? project.id : "",
    projectName: project?.name ?? "",
    runs: snapshot.runs,
    fresh,
  });

  useEffect(() => {
    setError(null);
  }, [task?.id]);

  // Thumbnails are object URLs; let them go when the composer unmounts.
  useEffect(
    () => () => {
      for (const item of attachmentsRef.current) {
        revokePreview(item);
      }
    },
    [],
  );

  useEffect(() => {
    if (!localNotice) {
      return;
    }
    const timer = window.setTimeout(() => setLocalNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [localNotice]);

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
      // Files first, so a failed upload leaves the draft intact instead of a half-sent message.
      const files: FileMeta[] = [];
      for (const [index, item] of attachments.entries()) {
        if (!item.uploaded) {
          setProgress(attachments.length === 1 ? "正在上传附件…" : `正在上传附件 ${index + 1}/${attachments.length}…`);
          const uploaded = await client.uploadFile(item.file);
          item.uploaded = uploaded;
        }
        files.push(item.uploaded);
      }
      setProgress(files.length ? "正在发送…" : null);
      await onSend(plan, { text: draft.trim(), files });
      for (const item of attachments) {
        revokePreview(item);
      }
      setAttachments([]);
      setDraft("");
      requestAnimationFrame(resize);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      setBusy(false);
      textRef.current?.focus();
    }
  };

  const stage = (incoming: readonly File[]) => {
    if (!incoming.length || busy) {
      return;
    }
    const result = stageFiles(attachments, incoming, MAX_FILES_PER_MESSAGE, (file) => URL.createObjectURL(file));
    setAttachments(result.next);
    setLocalNotice(stageNotice(result, MAX_FILES_PER_MESSAGE));
    setError(null);
    textRef.current?.focus();
  };

  const removeAttachment = (key: string) => {
    setAttachments((current) => {
      const item = current.find((candidate) => candidate.key === key);
      if (item) {
        revokePreview(item);
      }
      return current.filter((candidate) => candidate.key !== key);
    });
    setPreview((current) => (current?.key === key ? null : current));
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

  const hint = error ?? progress ?? localNotice ?? notice ?? plan.hint;
  const hintTone = error ? " composer__hint--error" : progress ? "" : localNotice || notice ? " composer__hint--notice" : "";

  return (
    <div className={`composer composer--${variant}${dragging ? " composer--drag" : ""}`}>
      <form
        className="composer__card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onPaste={(event) => {
          const files = extractFiles(event.clipboardData);
          if (!files.length) {
            return;
          }
          // A picture copied from a browser also carries its alt text; keep the text paste when there is one.
          if (!event.clipboardData.getData("text/plain")) {
            event.preventDefault();
          }
          stage(files);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          stage(extractFiles(event.dataTransfer));
        }}
      >
        {attachments.length ? (
          <div className="composer__files" role="list" aria-label="待发送的附件">
            {attachments.map((item) =>
              item.kind === "image" && item.previewUrl ? (
                <div key={item.key} className="composer__thumb" role="listitem" title={item.file.name}>
                  <button type="button" className="composer__thumb-open" onClick={() => setPreview(item)} aria-label={`预览 ${item.file.name}`}>
                    <img src={item.previewUrl} alt="" />
                  </button>
                  <button type="button" className="composer__remove" onClick={() => removeAttachment(item.key)} disabled={busy} aria-label={`移除 ${item.file.name}`}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ) : (
                <div key={item.key} className="composer__filechip" role="listitem" title={item.file.name}>
                  <Icon name="file" size={15} />
                  <span className="composer__filechip-name">{item.file.name || "文件"}</span>
                  <span className="composer__filechip-size">{formatBytes(item.file.size)}</span>
                  <button type="button" className="composer__remove composer__remove--inline" onClick={() => removeAttachment(item.key)} disabled={busy} aria-label={`移除 ${item.file.name}`}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ),
            )}
          </div>
        ) : null}
        <textarea
          ref={textRef}
          rows={variant === "hero" ? 2 : 1}
          value={draft}
          autoFocus={autoFocus}
          placeholder={attachments.length && !draft ? "给这些附件配一句话（可不填）…" : placeholder}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && desktop && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
              return;
            }
            // Undo with nothing typed takes back the last attachment, like un-pasting it.
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !draft && attachments.length) {
              event.preventDefault();
              removeAttachment(attachments[attachments.length - 1]!.key);
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
              stage(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button type="button" className="icon-btn icon-btn--plain composer__attach" onClick={() => fileRef.current?.click()} title="添加图片或文件" disabled={busy}>
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
      <p className={`composer__hint${hintTone}`}>
        <span className="composer__hint-text">
          {hint}
          {hint === plan.hint && plan.continuing ? (
            <button type="button" className="link-btn link-btn--muted composer__hint-link" onClick={() => onFresh(true)}>
              改为新会话
            </button>
          ) : null}
          {hint === plan.hint && plan.canContinue ? (
            <button type="button" className="link-btn link-btn--muted composer__hint-link" onClick={() => onFresh(false)}>
              接着上次会话
            </button>
          ) : null}
        </span>
        {desktop && hint === plan.hint ? <span className="composer__keys">Enter 发送 · Shift+Enter 换行 · 可直接粘贴截图</span> : null}
      </p>
      {preview?.previewUrl ? <Lightbox src={preview.previewUrl} name={preview.file.name || "图片"} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function revokePreview(item: DraftAttachment): void {
  if (item.previewUrl) {
    URL.revokeObjectURL(item.previewUrl);
  }
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

/** What each access level means in practice differs per CLI; cursor-agent in headless mode refuses every command unless forced. */
const ACCESS_NOTES: Partial<Record<AgentKind, Record<AgentAccess, string>>> = {
  cursor: { safe: "能读写项目文件，但所有终端命令都会被拒绝", full: "终端命令也直接执行，不再询问" },
};
const DEFAULT_ACCESS_NOTES: Record<AgentAccess, string> = { safe: "只改项目内文件，危险命令会被拦", full: "任何命令直接执行" };

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
  const notes = (agent && ACCESS_NOTES[agent]) || DEFAULT_ACCESS_NOTES;
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
                  <span>{notes.safe}</span>
                </button>
                <button type="button" className={access === "full" ? "menu__seg menu__seg--on menu__seg--warn" : "menu__seg"} onClick={() => onPick(agent, "full")}>
                  完全放开
                  <span>{notes.full}</span>
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}
