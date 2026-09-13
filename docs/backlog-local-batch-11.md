# Next-hour backlog (after opt/local-batch-11)

Branched from `opt/local-batch-10` (#10). Merge order: #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → #10 → **#11**.

Shipped in this batch: tray `countRunStatuses` / Chinese status labels + skip `Menu.buildFromTemplate` when signature unchanged; shared `hasParentRunId` (RunBlock no longer treats null/"" as delegated); terminal dock duration reuses `formatDuration`; tray-status unit tests.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#11 stack. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending (lean noted in #8); no product expansion.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — lean is option 1 (narrow); still needs a human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs; host-side identity reuse is already in place for devices/runs/LAN.
3. **Use advertise log in the wild** — confirm `sessionCapabilities.close advertised` rate after Cursor host starts.
4. **Fake AgentHost over pipes** — optional stdin/stdout inject so ready/newSession/prompt can smoke without spawn; hung-prompt helpers already cover cancel/abandon.
5. **Composer chip custom equality** — if hub ever replaces `projects`/`agents` arrays on every snapshot, add a shallow signature compare; today hub reuses those refs on run-only ticks.
6. **Tray remote-controller row** — `onControllersChanged` already refreshes the menu but no status line shows active remote peers; only if 0010 stays enabled.
