# Next-hour backlog (after opt/local-batch-6)

Branched from `opt/local-batch-5` (#5). Merge order: #2 → #3 → #4 → #5 → **#6**.

Shipped in this batch: idle `session/close` before host kill + LRU session prune (cap 4), permission-queue + cancel-escalation pure helpers/tests, TaskRow/BoardItem memo, board label「进行中」+ mirror hint, model-chip refresh thrash fix, SSH reset/handshake explain edges.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#5 stack for overlapping fixes (warm session-first, live batching, conversation tests, run-start try/catch, string response ids). Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; see batch-4/5 backlog. Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending; no product expansion.

## Next ideas (title + why)

1. **Measure Cursor `sessionCapabilities.close` advertise rate** — prune/idle-close only help when advertised; log once per host start if useful.
2. **Decide remote desktop (0010)** — narrow / keep / remove.
3. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs first.
4. **Runner integration smoke for cancel×permission** — helpers cover FIFO settle + escalation policy; an Electron-free fake-host harness would catch ordering regressions end-to-end.
5. **Composer attachment/preview memo** — large paste boards still remount with every snapshot tick.
