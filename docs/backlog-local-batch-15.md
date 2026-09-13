# Next-hour backlog (after opt/local-batch-15)

Branched from `opt/local-batch-14` (#14, still open). Merge order: #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → #10 → #11 → #12 → #13 → #14 → **#15**.

Shipped in this batch: shared `isRunActive` (conversation / list / scheduler); `topLevelActiveRun` for composer/plan/dock; attention permission index (O(tasks+runs)); one-pass project grouping in `buildSections` (skip filter when query empty); `countAllProjectRuns` for settings cards; `firstLine` scan without split; README fold copy uses「36 秒」.

## Note on #1

`opt/local-batch-1` / PR #1 is **already closed** as superseded by the #2→#15 stack. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Verified merge state

- **main**: #2–#13 only (`gh pr list` / `origin/main` at Merge #13).
- **#14**: open on `opt/local-batch-14`.
- **#15**: this PR, stacked on #14.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending (lean noted in #8); no product expansion.
- **Composer chip custom equality** — hub still reuses `projects`/`agents` refs on run-only ticks; defer until a bust is measured.
- **Fake AgentHost over pipes** — hung-prompt helpers already cover cancel/abandon; full stdin/stdout inject still optional.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — lean is option 1 (narrow); still needs a human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs; host-side identity reuse is already in place for devices/runs/LAN/agents/remote.
3. **Use advertise log in the wild** — confirm `sessionCapabilities.close advertised` rate after Cursor host starts.
4. **Fake AgentHost over pipes** — optional stdin/stdout inject so ready/newSession/prompt can smoke without spawn.
5. **Composer chip custom equality** — if hub ever replaces `projects`/`agents` arrays on every snapshot, add a shallow signature compare.
6. **Tray remote-controller row** — `onControllersChanged` already refreshes the menu but no status line shows active remote peers; only if 0010 stays enabled.
