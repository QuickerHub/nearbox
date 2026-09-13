# Next-hour backlog (after opt/local-batch-1)

Shipped in this batch: stuck-run try/catch, permission waiter overwrite, warm-session model discovery, live event batching, ACP string response ids, conversation tests, composer busy ignores delegated children.

## Next ideas (title + why)

1. **Incremental transcript builder** — `buildTranscript` rescans the whole event list on every flush; long turns still jank despite 50ms batching.
2. **Memoize RunTranscript rows** — work rows remount when the answer streams; `React.memo` on ToolRow/WorkItem would cut DOM work.
3. **Queue concurrent permission asks** — today a second ask cancels the first; a FIFO queue would match parallel tool calls if ACP starts issuing them.
4. **Warm-host dispose on cancel grace** — killing the whole host after 10s cancels every other session; prefer session-scoped force-cancel if ACP grows one.
5. **Model refresh coalescing in the UI** — App refreshes on agent chip change; opening the model menu should share one in-flight promise visibly (spinner / “正在更新”).
6. **Extract `runStart` failure taxonomy tests** — pure helpers for “CLI missing / cwd missing / warm fallback reasons” so runner regressions are cheaper than Electron runs.
7. **Snapshot diffing for WS broadcasts** — full HostSnapshot on every run event is heavy on phone; patch-style updates would shrink LAN traffic.
8. **Decide remote desktop (0010)** — code weight ≈ composer; product still “待定”; pick narrow/keep/remove so maintenance cost matches scope.
9. **ACP `session/list` cache during warm** — loadSession lists every time; short TTL cache per host avoids repeated RPCs when flicking tasks.
10. **Docs drift pass** — README “回复为什么快” vs warm-fallback edge cases; keep behaviour and prose aligned after ACP changes.

