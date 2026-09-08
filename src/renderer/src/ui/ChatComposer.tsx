import { useEffect, useRef, useState } from "react";
import {
  AGENT_LABELS,
  type AgentAccess,
  type AgentInfo,
  type AgentKind,
  type AgentModel,
  canListModels,
  compactModelLabel,
  depthLabel,
  depthOf,
  familiesAreFoldable,
  type FileMeta,
  familyHint,
  filterModels,
  findFamily,
  groupModelFamilies,
  idePrefForFamily,
  type HostSnapshot,
  type IdeModelPref,
  isRunActive,
  MAX_FILES_PER_MESSAGE,
  type ModelFamily,
  modelLabel,
  modelsForAgent,
  modelsNeedRefresh,
  normalizeModelId,
  parseModelAlias,
  pickInFamily,
  presentFamilies,
  pickVariant,
  sameDepth,
  type Task,
  type ThinkingDepth,
  variantCanToggleFast,
} from "@shared/protocol";
import { type DraftAttachment, extractFiles, stageFiles, stageNotice } from "../lib/attachments";
import type { ClientHandle } from "../lib/client";
import { formatBytes, formatRelative } from "../lib/format";
import { conversationRun, planSend, type SendAction, type SendPlan } from "../lib/plan";
import { Lightbox } from "./Attachments";
import { ContextMeter } from "./bits";
import { Icon, type IconName } from "./Icons";
import { Menu, MenuDivider, MenuFlyout, MenuHeading, MenuItem, MenuSwitch } from "./Menu";
import { TerminalDock } from "./TerminalDock";

export interface ComposerChips {
  projectId: string;
  agent: AgentKind | "";
  access: AgentAccess;
  /** Model id for the agent's `--model`; "" leaves it to the settings default, then the CLI's own default. */
  model: string;
  /** The agent may hand sub-tasks to the other agents on this PC through the `nearbox` command. */
  delegate: boolean;
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
  const [lingerRunId, setLingerRunId] = useState<string | null>(null);
  useEffect(() => {
    setLingerRunId(null);
  }, [task?.id]);
  useEffect(() => {
    if (activeRun && activeRun.status !== "queued") {
      setLingerRunId(activeRun.id);
    }
  }, [activeRun, activeRun?.status]);
  const dockRun =
    activeRun && activeRun.status !== "queued"
      ? activeRun
      : lingerRunId
        ? snapshot.runs.find((run) => run.id === lingerRunId)
        : undefined;

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
        : "接着说，或点右边开一段新会话…"
    : chips.agent
      ? desktop
        ? "想让 Agent 做什么？回车就发给它"
        : "想让 Agent 做什么？"
      : "记一条想法、bug、要做的事…";

  const hint = error ?? progress ?? localNotice ?? notice ?? plan.hint;
  const hintTone = error ? " composer__hint--error" : progress ? "" : localNotice || notice ? " composer__hint--notice" : "";
  const conversation = task && chips.agent && project ? conversationRun(snapshot.runs, task.id, chips.agent, project.id) : undefined;
  const usage = activeRun?.usage ?? conversation?.usage;

  return (
    <div className={`composer composer--${variant}${dragging ? " composer--drag" : ""}`}>
      <div className="composer__stack">
        {dockRun ? <TerminalDock client={client} run={dockRun} onStop={onStop} /> : null}
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
          <div className="composer__chips">
            <ProjectMenu snapshot={snapshot} client={client} projectId={project?.id ?? ""} onPick={(projectId) => onChips({ projectId })} />
            <AgentMenu
              snapshot={snapshot}
              agent={chips.agent}
              access={chips.access}
              delegate={chips.delegate}
              remoteProject={Boolean(project?.deviceId)}
              onPick={(agent, access) => onChips({ agent, access })}
              onDelegate={(delegate) => onChips({ delegate })}
            />
            {chips.agent && desktop ? <AccessMenu agent={chips.agent} access={chips.access} onPick={(access) => onChips({ access })} /> : null}
            {chips.agent ? <ModelMenu snapshot={snapshot} client={client} agent={chips.agent} model={chips.model} onPick={(model) => onChips({ model })} /> : null}
          </div>
          <div className="composer__actions">
            {usage || chips.agent ? <ContextMeter usage={usage} busy={Boolean(activeRun) && !usage} /> : null}
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
                <span>停止</span>
              </button>
            ) : null}
            <button className={`composer__send${plan.action === "note" || plan.action === "capture" ? " composer__send--quiet" : ""}`} type="submit" disabled={busy || !plan.enabled} title={plan.hint}>
              {busy ? <span className="spinner spinner--light" /> : <Icon name={SEND_ICON[plan.action]} size={14} />}
              <span className="composer__send-label">{plan.label}</span>
            </button>
          </div>
        </div>
      </form>
      </div>
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
        {desktop && hint === plan.hint ? (
          <span className="composer__hint-aside">
            <span className="composer__keys">Enter 发送 · Shift+Enter 换行 · 可直接粘贴截图</span>
          </span>
        ) : null}
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
            {/* Not a <form>: nested inside the composer's form its onSubmit never fires and the page reloads instead. */}
            <div className="menu__form-row">
              <input
                value={path}
                placeholder={desktop ? "或粘贴路径，如 D:\\source\\my-app" : "电脑上的目录路径，如 D:\\source\\my-app"}
                onChange={(event) => setPath(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    // Enter here must add the project, not submit the composer.
                    event.preventDefault();
                    event.stopPropagation();
                    void add(path, close);
                  }
                }}
              />
              <button type="button" className="ghost" disabled={busy || !path.trim()} onClick={() => void add(path, close)}>
                添加
              </button>
            </div>
            {error ? <p className="alert">{error}</p> : null}
          </div>
        </>
      )}
    </Menu>
  );
}

/** What each access level means in practice differs per CLI; cursor-agent reviews shell in safe mode. */
const ACCESS_NOTES: Partial<Record<AgentKind, Record<AgentAccess, string>>> = {
  cursor: { safe: "读写文件直接做，终端命令先问你允许还是拒绝", full: "终端命令也直接执行，不再询问" },
};
const DEFAULT_ACCESS_NOTES: Record<AgentAccess, string> = { safe: "危险命令会先问你", full: "任何命令直接执行" };

function AccessMenu({
  agent,
  access,
  onPick,
}: {
  agent: AgentKind;
  access: AgentAccess;
  onPick(access: AgentAccess): void;
}): JSX.Element {
  const notes = ACCESS_NOTES[agent] ?? DEFAULT_ACCESS_NOTES;
  return (
    <Menu icon={access === "full" ? "bolt" : "ban"} label={access === "full" ? "完全放开" : "安全模式"} tone={access === "full" ? "warn" : "default"} title="权限">
      {(close) => (
        <>
          <MenuHeading>权限</MenuHeading>
          <MenuItem
            icon="ban"
            label="安全模式"
            sub={notes.safe}
            on={access === "safe"}
            onClick={() => {
              onPick("safe");
              close();
            }}
          />
          <MenuItem
            icon="bolt"
            label="完全放开"
            hint="run everything"
            sub={notes.full}
            on={access === "full"}
            onClick={() => {
              onPick("full");
              close();
            }}
          />
        </>
      )}
    </Menu>
  );
}

function AgentMenu({
  snapshot,
  agent,
  access,
  delegate,
  remoteProject,
  onPick,
  onDelegate,
}: {
  snapshot: HostSnapshot;
  agent: AgentKind | "";
  access: AgentAccess;
  delegate: boolean;
  /** The chosen project is on another computer, where the `nearbox` command does not exist. */
  remoteProject: boolean;
  onPick(agent: AgentKind | "", access?: AgentAccess): void;
  onDelegate(delegate: boolean): void;
}): JSX.Element {
  const label = agent ? `${AGENT_LABELS[agent]}${delegate && !remoteProject ? " · 可委派" : ""}` : "只记录";
  const anyAvailable = snapshot.agents.some((item) => item.available);
  const notes = (agent && ACCESS_NOTES[agent]) || DEFAULT_ACCESS_NOTES;
  const others = snapshot.agents.filter((info) => info.available && info.kind !== agent).map((info) => AGENT_LABELS[info.kind]);
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
              onPick("");
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
                onPick(info.kind);
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
                  <span>run everything · {notes.full}</span>
                </button>
              </div>
              <MenuDivider />
              <MenuHeading>协作</MenuHeading>
              <button
                type="button"
                role="switch"
                aria-checked={delegate && !remoteProject}
                className={delegate && !remoteProject ? "menu__toggle menu__toggle--on" : "menu__toggle"}
                disabled={remoteProject}
                onClick={() => onDelegate(!delegate)}
              >
                <span className="menu__toggle-text">
                  允许委派给其他 Agent
                  <span>
                    {remoteProject
                      ? "项目在另一台电脑上时不可用"
                      : others.length
                        ? `它可以用 nearbox 命令把子任务交给 ${others.join(" / ")}，等对方做完拿回答；安全模式下每条终端命令都会先问你`
                        : "这台电脑上没有别的 Agent 可以委派，也可以交给同类的另一个会话"}
                  </span>
                </span>
                <span className="menu__toggle-switch" aria-hidden />
              </button>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}

/** Catalogs longer than this get a search box. */
const SEARCHABLE_FROM = 8;

/**
 * Which model the chosen agent runs with. Appears next to the agent chip once
 * an agent is picked; "默认" hands the choice back to the settings, then the CLI.
 */
function ModelMenu({
  snapshot,
  client,
  agent,
  model,
  onPick,
}: {
  snapshot: HostSnapshot;
  client: ClientHandle;
  agent: AgentKind;
  model: string;
  onPick(model: string): void;
}): JSX.Element {
  const info = snapshot.agents.find((item) => item.kind === agent);
  const models = modelsForAgent(agent, info);
  const settingsDefault = snapshot.settings.agents[agent]?.model ?? "";
  const cliDefault = models.find((item) => item.isDefault);
  // A model the CLI itself listed is a safe pick; anything else (typed, or dropped since) gets flagged.
  const unlisted = Boolean(model) && Boolean(info?.models?.length) && !models.some((item) => item.id === model);
  const families = groupModelFamilies(models);
  const foldable = familiesAreFoldable(families);
  const effectiveId = model || settingsDefault || cliDefault?.id || "";
  const label = foldable && effectiveId
    ? compactModelLabel(models, effectiveId) || modelLabel(models, effectiveId)
    : model
      ? modelLabel(models, model)
      : settingsDefault
        ? modelLabel(models, settingsDefault)
        : cliDefault?.label ?? cliDefault?.id ?? "默认模型";
  const title = unlisted
    ? `${model} 不在 ${AGENT_LABELS[agent]} 当前的模型列表里，可能已下线或拼写有误`
    : model
      ? `这次用 ${model}`
      : settingsDefault
        ? `设置里的默认模型：${settingsDefault}`
        : `模型由 ${AGENT_LABELS[agent]} 自己决定`;
  return (
    <Menu icon="sparkles" label={label} title={title} tone={unlisted ? "warn" : model ? "default" : "muted"} panelClassName={foldable ? "menu__panel--picker" : "menu__panel--split"}>
      {(close) => (
        <ModelPanel
          agent={agent}
          info={info}
          models={models}
          model={model}
          unlisted={unlisted}
          settingsDefault={settingsDefault}
          client={client}
          onPick={onPick}
          onClose={close}
        />
      )}
    </Menu>
  );
}

function ModelPanel({
  agent,
  info,
  models,
  model,
  unlisted,
  settingsDefault,
  client,
  onPick,
  onClose,
}: {
  agent: AgentKind;
  info: AgentInfo | undefined;
  models: AgentModel[];
  model: string;
  /** The current pick is not in the list the CLI reported. */
  unlisted: boolean;
  settingsDefault: string;
  client: ClientHandle;
  onPick(model: string): void;
  onClose(): void;
}): JSX.Element {
  const families = groupModelFamilies(models);
  const catalog = useModelCatalog(agent, info, client);
  if (familiesAreFoldable(families)) {
    return (
      <FoldedModelPicker
        agent={agent}
        families={families}
        models={models}
        model={model}
        unlisted={unlisted}
        settingsDefault={settingsDefault}
        phone={client.surface === "phone"}
        ideModels={info?.ideModels}
        catalog={catalog}
        onPick={onPick}
        onClose={onClose}
      />
    );
  }
  return (
    <FlatModelList
      agent={agent}
      models={models}
      model={model}
      unlisted={unlisted}
      settingsDefault={settingsDefault}
      desktop={client.surface === "desktop"}
      catalog={catalog}
      onPick={(next) => {
        onPick(next);
        onClose();
      }}
    />
  );
}

interface CatalogState {
  listable: boolean;
  refreshing: boolean;
  source: string | null;
  warn: boolean;
  refresh(force: boolean): void;
}

function useModelCatalog(agent: AgentKind, info: AgentInfo | undefined, client: ClientHandle): CatalogState {
  const [refreshing, setRefreshing] = useState(false);
  const listable = canListModels(agent) && Boolean(info?.available);

  const refresh = (force: boolean) => {
    setRefreshing(true);
    void client
      .refreshModels(agent, force)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  // Opening the picker on a stale or missing catalog re-asks the CLI; the host ignores repeats within a minute.
  useEffect(() => {
    if (info && modelsNeedRefresh(info)) {
      refresh(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  const source = listable
    ? info?.modelsError
      ? info.models?.length
        ? `刷新失败，沿用 ${formatRelative(info.modelsCheckedAt) || "之前"}的列表：${info.modelsError}`
        : `获取失败：${info.modelsError}`
      : info?.models?.length
        ? `列表来自 ${AGENT_LABELS[agent]} 命令行，${formatRelative(info.modelsCheckedAt) || "刚刚"}更新`
        : refreshing
          ? `正在向 ${AGENT_LABELS[agent]} 询问可用的模型…`
          : null
    : canListModels(agent)
      ? null
      : `${AGENT_LABELS[agent]} 不提供模型列表；可以输入别名（如 sonnet、opus）或完整模型名。`;

  return { listable, refreshing, source, warn: Boolean(info?.modelsError), refresh };
}

/** Cursor-style: Fast / 思考深度 / 模型. Desktop uses flyouts; phone shows the catalog in one sheet. */
function FoldedModelPicker({
  agent,
  families,
  models,
  model,
  unlisted,
  settingsDefault,
  phone,
  ideModels,
  catalog,
  onPick,
  onClose,
}: {
  agent: AgentKind;
  families: ModelFamily[];
  models: AgentModel[];
  model: string;
  unlisted: boolean;
  settingsDefault: string;
  phone: boolean;
  ideModels?: IdeModelPref[];
  catalog: CatalogState;
  onPick(model: string): void;
  onClose(): void;
}): JSX.Element {
  const effectiveId = model || settingsDefault || models.find((item) => item.isDefault)?.id || "";
  const family = findFamily(families, model) ?? (!model ? findFamily(families, effectiveId) : undefined);
  const alias = (model && parseModelAlias(model)) || (effectiveId ? parseModelAlias(effectiveId) : undefined);
  const depth = alias ? depthOf(alias) : { kind: "default" as const };
  const fast = alias?.fast === true;
  const showEffort = Boolean(family && family.depths.length > 1);
  const showFast = Boolean(family?.hasFastToggle);
  const canFast = family ? variantCanToggleFast(family, depth) : false;

  const applyDepth = (next: ThinkingDepth) => {
    if (!family) {
      return;
    }
    onPick(pickVariant(family, next, fast).id);
  };

  const applyFamily = (next: ModelFamily) => {
    onPick(pickInFamily(next, { depth, fast }).id);
    if (phone) {
      onClose();
    }
  };

  const catalogView = (
    <FamilyCatalog
      agent={agent}
      families={families}
      model={model}
      unlisted={unlisted}
      settingsDefault={settingsDefault}
      desktop={!phone}
      ideModels={ideModels}
      catalog={catalog}
      onPickDefault={() => {
        onPick("");
        onClose();
      }}
      onPickFamily={applyFamily}
      onCustom={(id) => {
        onPick(id);
        onClose();
      }}
    />
  );

  const effortView = family ? <EffortList family={family} depth={depth} onPick={applyDepth} /> : null;
  const toggles = (
    <>
      {showFast ? (
        <MenuSwitch
          label="Fast"
          on={fast}
          disabled={!canFast}
          onClick={() => family && onPick(pickVariant(family, depth, !fast).id)}
        />
      ) : null}
      {showEffort ? (
        phone ? (
          <>
            <MenuHeading>思考深度 · {depthLabel(depth)}</MenuHeading>
            {effortView}
            <MenuDivider />
          </>
        ) : (
          <MenuFlyout label="思考深度" value={depthLabel(depth)}>
            {effortView}
          </MenuFlyout>
        )
      ) : null}
    </>
  );

  if (phone) {
    return (
      <>
        {toggles}
        {catalogView}
      </>
    );
  }

  return (
    <>
      {toggles}
      <MenuFlyout label="模型" value={model ? (family ? (idePrefForFamily(family, ideModels)?.label ?? family.label) : model) : "默认"} panelClassName="menu-flyout__panel--catalog">
        {catalogView}
      </MenuFlyout>
    </>
  );
}

function EffortList({
  family,
  depth,
  onPick,
}: {
  family: ModelFamily;
  depth: ThinkingDepth;
  onPick(depth: ThinkingDepth): void;
}): JSX.Element {
  return (
    <>
      {family.depths.map((item) => (
        <MenuItem key={item.kind === "effort" ? item.effort : item.kind} plain label={depthLabel(item)} on={sameDepth(item, depth)} onClick={() => onPick(item)} />
      ))}
    </>
  );
}

function FamilyCatalog({
  agent,
  families,
  model,
  unlisted,
  settingsDefault,
  desktop,
  ideModels,
  catalog,
  onPickDefault,
  onPickFamily,
  onCustom,
}: {
  agent: AgentKind;
  families: ModelFamily[];
  model: string;
  unlisted: boolean;
  settingsDefault: string;
  desktop: boolean;
  ideModels?: IdeModelPref[];
  catalog: CatalogState;
  onPickDefault(): void;
  onPickFamily(family: ModelFamily): void;
  onCustom(id: string): void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const { current: visible, older } = presentFamilies(families, query, model, ideModels);
  const fromIde = Boolean(ideModels?.length);
  const familyName = (item: ModelFamily) => idePrefForFamily(item, ideModels)?.label ?? item.label;
  const customId = normalizeModelId(custom);
  const current = findFamily(families, model);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <>
      <div className="menu__head">
        <div className="menu__heading menu__heading--row">
          <span>模型 · {AGENT_LABELS[agent]}</span>
          {catalog.listable ? (
            <button type="button" className="icon-btn icon-btn--plain menu__heading-btn" onClick={() => catalog.refresh(true)} disabled={catalog.refreshing} title="重新从命令行工具获取模型列表">
              {catalog.refreshing ? <span className="spinner spinner--small" /> : <Icon name="refresh" size={13} />}
            </button>
          ) : null}
        </div>
        {families.length >= SEARCHABLE_FROM ? (
          <div className="menu__search">
            <Icon name="search" size={14} />
            <input
              value={query}
              autoFocus={desktop}
              placeholder="搜索模型…"
              onChange={(event) => setQuery(event.target.value)}
              onPointerDown={stop}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (visible[0]) {
                    onPickFamily(visible[0]);
                  }
                }
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="menu__list">
        {!query ? (
          <MenuItem
            plain
            label="默认"
            sub={settingsDefault ? `设置里的默认模型：${settingsDefault}` : `由 ${AGENT_LABELS[agent]} 自己决定`}
            on={!model}
            onClick={onPickDefault}
          />
        ) : null}
        {model && !current && !query ? (
          <MenuItem plain label={model} sub={unlisted ? `不在 ${AGENT_LABELS[agent]} 当前的模型列表里` : "手动输入的模型"} on onClick={() => undefined} />
        ) : null}
        {!query && visible.length ? <MenuDivider /> : null}
        {visible.map((item) => (
          <MenuItem
            key={item.key}
            plain
            label={familyName(item)}
            hint={familyHint(item)}
            on={Boolean(model) && current?.key === item.key}
            onClick={() => onPickFamily(item)}
          />
        ))}
        {!query && older.length ? (
          <button type="button" className="menu-more" aria-expanded={showOlder} onClick={() => setShowOlder((value) => !value)}>
            <span>{showOlder ? "收起未开启的模型" : fromIde ? `未在 Cursor 中开启 · ${older.length}` : `更旧的模型 · ${older.length}`}</span>
            <Icon name={showOlder ? "chevron-up" : "chevron-down"} size={14} />
          </button>
        ) : null}
        {showOlder && !query
          ? older.map((item) => (
              <MenuItem
                key={item.key}
                plain
                label={familyName(item)}
                hint={familyHint(item)}
                on={Boolean(model) && current?.key === item.key}
                onClick={() => onPickFamily(item)}
              />
            ))
          : null}
        {query && !visible.length ? <p className="menu__note">没有匹配的模型，可以在下面直接输入。</p> : null}
      </div>
      <div className="menu__foot">
        <MenuDivider />
        <div className="menu__form-row menu__form">
          <input
            value={custom}
            placeholder="其他模型 ID…"
            onChange={(event) => setCustom(event.target.value)}
            onPointerDown={stop}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (customId) {
                  onCustom(customId);
                }
              }
            }}
          />
          <button type="button" className="ghost" disabled={!customId} onClick={() => customId && onCustom(customId)}>
            使用
          </button>
        </div>
        {catalog.source ? <p className={catalog.warn ? "menu__note menu__note--warn" : "menu__note"}>{fromIde ? `${catalog.source}；开关对照本机 Cursor IDE` : catalog.source}</p> : null}
      </div>
    </>
  );
}

function FlatModelList({
  agent,
  models,
  model,
  unlisted,
  settingsDefault,
  desktop,
  catalog,
  onPick,
}: {
  agent: AgentKind;
  models: AgentModel[];
  model: string;
  unlisted: boolean;
  settingsDefault: string;
  desktop: boolean;
  catalog: CatalogState;
  onPick(model: string): void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const searchable = models.length >= SEARCHABLE_FROM;
  const shown = filterModels(models, query);
  const known = models.some((item) => item.id === model);
  const customId = normalizeModelId(custom);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <>
      <div className="menu__head">
        <div className="menu__heading menu__heading--row">
          <span>模型 · {AGENT_LABELS[agent]}</span>
          {catalog.listable ? (
            <button type="button" className="icon-btn icon-btn--plain menu__heading-btn" onClick={() => catalog.refresh(true)} disabled={catalog.refreshing} title="重新从命令行工具获取模型列表">
              {catalog.refreshing ? <span className="spinner spinner--small" /> : <Icon name="refresh" size={13} />}
            </button>
          ) : null}
        </div>
        {searchable ? (
          <div className="menu__search">
            <Icon name="search" size={14} />
            <input
              value={query}
              autoFocus={desktop}
              placeholder="搜索模型…"
              onChange={(event) => setQuery(event.target.value)}
              onPointerDown={stop}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (shown[0]) {
                    onPick(shown[0].id);
                  }
                }
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="menu__list">
        {!query ? (
          <MenuItem
            icon="sparkles"
            label="默认"
            sub={settingsDefault ? `设置里的默认模型：${settingsDefault}` : `由 ${AGENT_LABELS[agent]} 自己决定`}
            on={!model}
            onClick={() => onPick("")}
          />
        ) : null}
        {model && !known && !query ? (
          <MenuItem label={model} sub={unlisted ? `不在 ${AGENT_LABELS[agent]} 当前的模型列表里` : "手动输入的模型"} on onClick={() => onPick(model)} />
        ) : null}
        {shown.map((item) => (
          <MenuItem
            key={item.id}
            label={item.label ?? item.id}
            sub={item.label ? `${item.id}${item.isDefault ? " · CLI 默认" : ""}` : item.isDefault ? "CLI 默认" : undefined}
            on={item.id === model}
            onClick={() => onPick(item.id)}
          />
        ))}
        {searchable && !shown.length ? <p className="menu__note">没有匹配的模型，可以在下面直接输入。</p> : null}
      </div>
      <div className="menu__foot">
        <MenuDivider />
        <div className="menu__form-row menu__form">
          <input
            value={custom}
            placeholder="其他模型 ID…"
            onChange={(event) => setCustom(event.target.value)}
            onPointerDown={stop}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (customId) {
                  onPick(customId);
                }
              }
            }}
          />
          <button type="button" className="ghost" disabled={!customId} onClick={() => customId && onPick(customId)}>
            使用
          </button>
        </div>
        {catalog.source ? <p className={catalog.warn ? "menu__note menu__note--warn" : "menu__note"}>{catalog.source}</p> : null}
      </div>
    </>
  );
}
