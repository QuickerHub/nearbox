# Local optimization PR stack

Human-facing merge guide for the QuickerHub/nearbox local reliability / perf batches.

## Merge order

Merge **FIFO from #2 upward**. Do **not** merge #1 onto main.

| PR | Branch | Role |
| --- | --- | --- |
| **#2** | `opt/local-batch-2` | Base: FIFO permission queue, incremental transcript, softer warm cancel, session/list TTL, model-refresh chip |
| **#3** | `opt/local-batch-3` | run-start taxonomy tests, permission remaining count, streaming Markdown seal |
| **#4** | `opt/local-batch-4` | sealed MD memo, remote preflight/SSH taxonomy, `$/cancel_request` force-cancel |
| **#5** | `opt/local-batch-5` | warm session-first models, abandon hung prompts, live event batch, composer ignores delegated busy |
| **#6** | `opt/local-batch-6` | idle `session/close` + LRU prune, cancel/permission helpers, task-list memo, SSH explain edges |
| **#7** | `opt/local-batch-7` | composer top-level busy, attachment memo, cancel×permission harness, close-advertise log |
| **#8** | `opt/local-batch-8` | composer chip-row memo, fake-host warm-cancel smoke, 0010 lean note |
| **#9** | `opt/local-batch-9` | hung-prompt ACP smoke, snapshot `runs` reuse ≤120, live-event catch-up helpers |
| **#10** | `opt/local-batch-10` | devices/hostAddresses snapshot reuse, Chinese run duration, `isTopLevelActiveRun` null-safety, file sanitize tests |
| **#11** | `opt/local-batch-11` | tray run-count/labels + skip unchanged Menu, `hasParentRunId` / RunBlock null-safety, dock duration dedupe |
| **#12** | `opt/local-batch-12` | `sameUsage` hot path, remote status reuse, agent-detect identity, `lastOutputLine` scan, `countActiveRuns` + hasParentRunId sweep |

Exact order: **#2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → #10 → #11 → #12**.

Each batch branch was cut from the previous (`opt/local-batch-N` from `opt/local-batch-(N-1)`), so merging in order is a fast-forward-friendly stack onto `main`.

## PR #1 is superseded

**Close `opt/local-batch-1` / PR #1 without merging.**

Overlapping fixes (warm session-first model mapping, live event batching, run-start try/catch, string JSON-RPC response ids, conversation tests) were re-landed on the #2→#5 stack.

**Keep the FIFO permission queue from #2.** Never restore #1’s “overwrite waiter” (a second ask must not orphan the first Promise by replacement alone — #2 queues; later batches drain/settle through the queue helpers).

## Still out of scope for this stack

- **Remote desktop (decision 0010)** — pending human call; lean toward「看一眼、点一下」noted in #8. No product expansion in these PRs. #12 only caches `RemoteStatus` identity / skips `getPrimaryDisplay` on unchanged controller rows.
- **Full WebSocket snapshot-patch protocol** — needs a designed `HostToClient` patch + client merge. Discover / `nearbox://` stay untouched. Host-side identity reuse for devices/runs/LAN/agents/remote is already in place without a wire change.

## Backlogs

Per-batch next-hour notes live under `docs/backlog-local-batch-*.md` (latest: `docs/backlog-local-batch-12.md` after #12 lands).
