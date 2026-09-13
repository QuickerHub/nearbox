# Next-hour backlog (after opt/local-batch-2)

Shipped in this batch: incremental transcript cursor + WorkRow identity reuse, memoised ToolRow/WorkItem, FIFO permission ask queue, softer warm-host cancel grace (skip kill when other sessions share the host), session/list TTL cache, visible model-refresh chip/menu state.

Independent of opt/local-batch-1 (branched from main).

## Next ideas (title + why)

1. **Extract `runStart` failure taxonomy tests** — pure helpers for “CLI missing / cwd missing / warm fallback reasons” so runner regressions are cheaper than Electron runs.
2. **Snapshot diffing for WS broadcasts** — full HostSnapshot on every run event is heavy on phone; patch-style updates would shrink LAN traffic.
3. **Decide remote desktop (0010)** — code weight ≈ composer; product still “待定”; pick narrow/keep/remove so maintenance cost matches scope.
4. **Docs drift pass** — README “回复为什么快” vs warm-fallback edge cases; keep behaviour and prose aligned after ACP changes.
5. **Session-scoped force-cancel** — if ACP gains one, replace the remaining sole-user host kill after cancel grace.
6. **Permission queue UI affordance** — when N>1 asks are queued, show “还有 N 条等待确认” so the user knows more is coming.
7. **Transcript answer streaming DOM** — Markdown remounts on each answer delta; consider a dedicated streaming text node for the answer only.

