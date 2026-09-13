# Next-hour backlog (after opt/local-batch-8)

Branched from `opt/local-batch-7` (#7). Merge order: #2 → #3 → #4 → #5 → #6 → #7 → **#8**.

Shipped in this batch: memoised composer chip menus (narrow props + stable `onChips`/`onPick*` so run-only snapshot ticks do not rebuild Project/Agent/Access/Model chips), thin fake-host warm-cancel smoke (`startWarmCancelOnHost` + runner wired to it; sharedness re-checked at soft grace), 0010 pending lean toward「看一眼、点一下」.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#7 stack for overlapping fixes. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; see earlier backlogs. Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending (lean noted); no product expansion.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — lean is option 1 (narrow); still needs a human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs first.
3. **Use advertise log in the wild** — confirm `sessionCapabilities.close advertised` rate after Cursor host starts.
4. **Fake ACP prompt smoke** — extend fake-host to a hung `session/prompt` that ignores soft cancel, asserting force + abandon without Electron.
5. **Composer chip custom equality** — if hub ever replaces `projects`/`agents` arrays on every snapshot, add a shallow signature compare; today hub reuses those refs on run-only ticks.
