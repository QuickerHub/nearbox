import { useEffect, useRef, useState } from "react";
import {
  contextUsed,
  formatContextUsage,
  formatTokens,
  RUN_STATUS_LABELS,
  type RunStatus,
  type TokenUsage,
  usageDetail,
  usageRatio,
} from "@shared/protocol";

export function RunStatusPill({ status, small }: { status: RunStatus; small?: boolean }): JSX.Element {
  return (
    <span className={`pill pill--${status}${small ? " pill--small" : ""}`}>
      {status === "running" ? <span className="spinner" /> : null}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

const RING_SIZE = 14;
const STROKE = 1.75;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Cursor-style context ring in the composer corner. The circle is the
 * occupancy; click it for the token breakdown.
 */
export function ContextMeter({ usage, busy }: { usage?: TokenUsage; busy?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const label = usage ? formatContextUsage(usage) : "";
  const hasData = Boolean(label);
  const ratio = usage ? usageRatio(usage) : undefined;
  const pct = ratio === undefined ? 0 : ratio * 100;
  const dashOffset = CIRCUMFERENCE - (hasData ? (pct / 100) * CIRCUMFERENCE : 0);
  const tone = ratio === undefined ? "" : ratio >= 0.9 ? " ctx-ring--high" : ratio >= 0.7 ? " ctx-ring--warn" : "";
  const title = hasData
    ? `上下文 ${label}`
    : busy
      ? "等待模型返回用量…"
      : "发送后显示上下文用量";

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`ctx-ring${tone}${busy && !hasData ? " ctx-ring--pending" : ""}${open ? " ctx-ring--open" : ""}`} ref={root}>
      <button
        type="button"
        className="ctx-ring__btn"
        aria-label="上下文使用量"
        aria-expanded={open}
        title={open ? undefined : title}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="ctx-ring__svg" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
          <circle className="ctx-ring__track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} />
          <circle
            className="ctx-ring__progress"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
      </button>
      {open ? (
        <div className="ctx-ring__popup" role="dialog" aria-label="上下文使用详情">
          <div className="ctx-ring__head">
            <span className="ctx-ring__title">上下文</span>
          </div>
          <div className="ctx-ring__overview">
            <span className="ctx-ring__pct">{hasData && ratio !== undefined ? `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%` : busy ? "…" : "0%"}</span>
            <div className="ctx-ring__overview-copy">
              <span className="ctx-ring__kicker">已使用</span>
              <span className={`ctx-ring__summary${hasData ? "" : " ctx-ring__summary--empty"}`}>
                {hasData ? label : busy ? "等待模型返回用量…" : "发送消息后显示"}
              </span>
            </div>
          </div>
          <div className="ctx-ring__meter" aria-hidden>
            <i style={{ width: hasData && ratio !== undefined ? `${pct}%` : "0%" }} />
          </div>
          {usage && hasData ? <UsageStats usage={usage} /> : null}
          <p className="ctx-ring__hint">{hasData ? usageDetail(usage!) : busy ? "本轮响应完成后更新" : "完成一轮对话后显示"}</p>
        </div>
      ) : null}
    </div>
  );
}

function UsageStats({ usage }: { usage: TokenUsage }): JSX.Element {
  const rows: Array<[string, string]> = [
    ["输入", formatTokens(usage.inputTokens)],
    ["输出", formatTokens(usage.outputTokens)],
  ];
  if (usage.cacheReadTokens) {
    rows.push(["缓存读取", formatTokens(usage.cacheReadTokens)]);
  }
  if (usage.cacheWriteTokens) {
    rows.push(["缓存写入", formatTokens(usage.cacheWriteTokens)]);
  }
  if (usage.reasoningTokens) {
    rows.push(["推理", formatTokens(usage.reasoningTokens)]);
  }
  if (usage.contextWindow) {
    rows.push(["窗口", formatTokens(usage.contextWindow)]);
  }
  rows.push(["占用", formatTokens(contextUsed(usage))]);
  if (usage.costUsd !== undefined) {
    rows.push(["费用", `$${usage.costUsd.toFixed(4)}`]);
  }
  return (
    <dl className="ctx-ring__stats">
      {rows.map(([name, value]) => (
        <div key={name} className="ctx-ring__stat">
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
