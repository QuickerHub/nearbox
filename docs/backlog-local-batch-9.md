# Next-hour backlog (after opt/local-batch-9)

Branched from `opt/local-batch-8` (#8). Merge order: #2 → #3 → #4 → #5 → #6 → #7 → #8 → **#9**.

Shipped in this batch: shared `prompt-control` soft/force/abandon helpers wired through AgentHost; hung-prompt fake-ACP smoke (`session/prompt` ignores soft + `$/cancel_request`, warm-cancel timeline abandons / kills); `recentRuns` reuses the snapshot runs array when ≤120; live event catch-up/dedupe helpers extracted from `useRunEvents` with tests.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#8 stack for overlapping fixes. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; see earlier backlogs. Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending (lean noted in #8); no product expansion.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — lean is option 1 (narrow); still needs a human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs first; `devices: [...values()]` still allocates every tick.
3. **Use advertise log in the wild** — confirm `sessionCapabilities.close advertised` rate after Cursor host starts.
4. **Composer chip custom equality** — if hub ever replaces `projects`/`agents` arrays on every snapshot, add a shallow signature compare; today hub reuses those refs on run-only ticks.
5. **Fake AgentHost over pipes** — optional inject of stdin/stdout into `AgentHost` so ready/newSession/prompt can smoke without spawn; hung-prompt helpers already cover cancel/abandon.
