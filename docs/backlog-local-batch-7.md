# Next-hour backlog (after opt/local-batch-7)

Branched from `opt/local-batch-6` (#6). Merge order: #2 → #3 → #4 → #5 → #6 → **#7**.

Shipped in this batch: composer `isTopLevelActiveRun` (ignore delegated busy for Stop/dock/placeholder), memoised draft attachment chips + `FileStrip`, cancel×permission harness (`warmCancelPhases` / `settlePermissionsOnCancel`) + `drainPermissionQueue` in runner, one-line `sessionCapabilities.close` advertise log per host start, README delegation note.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#6 stack for overlapping fixes. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; see batch-4/5/6 backlog. Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending; no product expansion.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — narrow / keep / remove.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs first.
3. **Use advertise log in the wild** — after a few Cursor host starts, confirm `sessionCapabilities.close advertised` rate; if rarely advertised, idle prune/close buys little.
4. **Composer chip callback stability** — ModelMenu/ProjectMenu still rebuild on every snapshot; optional memo of chip row if paste boards + busy runs still hitch.
5. **Fake-host runner smoke** — cancel-permission helpers cover policy; a thin in-process fake AgentHost could exercise runner.cancel timers without Electron.
