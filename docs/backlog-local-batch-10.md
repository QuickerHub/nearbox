# Next-hour backlog (after opt/local-batch-10)

Branched from `opt/local-batch-9` (#9). Merge order: #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → **#10**.

Shipped in this batch: `isTopLevelActiveRun` treats null/empty `parentRunId` like missing (align with plan/taskList); Chinese `formatDuration` units + format tests; snapshot devices array reuse via revision stamp; LAN `hostAddresses` TTL + content-stable reuse; `countOnlinePhones` without filter alloc; `sanitizeFileName` / `assertAllowedFile` tests; `docs/OPTIMIZATION-STACK.md`.

## Note on #1

`opt/local-batch-1` / PR #1 can be **closed as superseded** by the #2→#10 stack. Keep FIFO permission queue from #2 — never restore #1 overwrite waiter.

## Skipped this batch

- **WS snapshot patches** — still needs a designed patch protocol; devices reuse is not a patch. Discover/`nearbox://` stay untouched.
- **Remote desktop (0010)** — decision still pending (lean noted in #8); no product expansion.

## Next ideas (title + why)

1. **Decide remote desktop (0010)** — lean is option 1 (narrow); still needs a human call.
2. **WS snapshot patches (designed)** — measure phone LAN payload under busy runs; devices/hostAddresses identity is now stable on the host side for free.
3. **Use advertise log in the wild** — confirm `sessionCapabilities.close advertised` rate after Cursor host starts.
4. **Fake AgentHost over pipes** — optional stdin/stdout inject so ready/newSession/prompt can smoke without spawn.
5. **Tray run counts helper** — `refreshTrayMenu` still filters `runs` twice per snapshot; tiny extract if tray rebuild shows up in profiles.
