# Next-hour backlog (after opt/local-batch-17) — STOP

Branched from `opt/local-batch-16` (#16, still open). Merge order: #2 → … → #15 → #16 → **#17** (docs / review only).

This batch ships **no code**. It records the must-fix review of #16 and recommends **pausing the local micro-opt stack**.

## Review notes on #16 (must-fix pass)

- **Verdict**: **merge with nits** (no must-fix). Safe to land #14 → #15 → #16, then this docs PR.
- **Checked**:
  - Shared `src/shared/duration.ts` preserves Chinese units for RunBlock/dock (`formatSecondsDuration`) and CLI result rows (`formatMsDuration`); `formatDuration` / duration tests still green.
  - `topLevelTurnsForTask` matches Thread's prior `taskId && !hasParentRunId` filter (conversation tests).
  - `conversationRun` ↔ `findLast` is order-equivalent to the hand-rolled reverse loop.
  - `attentionIndexes` preserves `latestTurns` (last top-level wins) + first pending-permission (`.find` / `!map.has` order); attention tests still cover permission-on-child and first-waiter.
  - `partitionImages` / FileStrip split is predicate-equivalent to the old double `filter`.
  - `projectRuns` `isRunActive` matches prior `queued || running`.
  - FIFO permission queue from #2 still present; #1 overwrite waiter **not** restored; no 0010 / Discover / WS patch product expansion.
- **Fixes applied on #16**: none (no must-fix found).
- **Residual nits** (not blocking): `attentionIndexes` duplicates the `latestTurns` walk logic inline (harmless); `sessionIdAlongChain` Map from #14 remains overweight for short chains; more one-pass filter rewrites on tiny UI lists are diminishing returns.

## STOP recommendation

**Pause stacking further local reliability/perf batches** unless a measured user-visible bug, a missing test for a risky path, or a clear UX defect shows up.

Do **not** open another PR for:

1. More `filter` → one-pass rewrites on tiny UI lists.
2. More shared helpers that only wrap a one-liner.
3. Alloc-avoidance for arrays that stay well under a few hundred rows.
4. Docs-only backlog churn without a review or STOP purpose.
5. Full WS patch protocol / 0010 product work (out of scope until decided).

## Still waiting on humans (not this stack)

1. **Decide remote desktop (0010)** — lean toward「看一眼、点一下」; no product expansion here.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs first.
3. **Use advertise log in the wild** — `sessionCapabilities.close advertised` rate after Cursor host starts.
