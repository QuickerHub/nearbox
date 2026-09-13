# Next-hour backlog (after opt/local-batch-16)

Branched from `opt/local-batch-15` (#15, still open). Merge order: #2 → … → #14 → #15 → **#16**.

Shipped in this batch: shared `src/shared/duration.ts` (`formatSecondsDuration` / `formatMsDuration`) so RunBlock/dock and CLI result rows stay on the same Chinese units; `topLevelTurnsForTask` for Thread; attention latest+permission indexes in one walk; `partitionImages` for FileStrip; `conversationRun` via `findLast`; project run counters reuse `isRunActive`.

## Review notes on #14 / #15 (must-fix pass)

- **#14 / #15**: no must-fix correctness bugs found. FIFO permission queue from #2 still intact; #1 overwrite waiter not restored.
- Residual nits (not blocking): `firstLine` char-scan is denser than the old split (covered by tests); `sessionIdAlongChain` Map is overkill for short chains but harmless; stop stacking pure one-pass filter micro-opts.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending; no product expansion.
- **Composer chip custom equality** — defer until a bust is measured.
- **Fake AgentHost over pipes** — optional.

## Stop optimizing next (diminishing returns)

1. More `filter` → one-pass rewrites on tiny UI lists.
2. More shared helpers that only wrap a one-liner (`isRunActive`-style).
3. Alloc-avoidance for arrays that stay well under a few hundred rows.
4. Docs-only backlog churn without a measured user-visible win.
5. Full WS patch protocol / 0010 product work (out of scope until decided).

## Next ideas (only if measured)

1. **Decide remote desktop (0010)** — human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs.
3. **Use advertise log in the wild** — `sessionCapabilities.close advertised` rate.
