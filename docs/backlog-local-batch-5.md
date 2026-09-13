# Next-hour backlog (after opt/local-batch-5)

Branched from `opt/local-batch-4` (#4). Re-implemented #1 warm session-first model discovery onto the FIFO stack without restoring #1's overwrite permission waiter.

Shipped in this batch: warm session-first model mapping, run-start try/catch, local `rejectPending` / `abandonPrompt` after hung cancel, capability-gated `session/close` cleanup on warm fallback, live event batching, composer ignores delegated busy, conversation tests wired.

## Skipped this batch

- **Idle `session/close` policy** — capability is probed and used to release abandoned warm-fallback sessions; automatic idle close of loaded-but-unused sessions still needs a policy (which sessions, how long).
- **WS snapshot patches** — still needs a designed patch protocol; see batch-4 backlog.

## Next ideas (title + why)

1. **Idle session close policy** — when `supportsSessionClose`, release unused loaded sessions before killing the whole host after idle; measure Cursor advertise rate first.
2. **Decide remote desktop (0010)** — decision record already pending; do not expand product until product picks narrow/keep/remove.
3. **WS snapshot patches (designed)** — measure phone LAN payload size under busy runs before inventing diffs.
4. **Permission / cancel integration tests** — more coverage around FIFO settle-all + abandonPrompt ordering if runner seams get thinner.
5. **Merge #1 leftovers carefully** — string response ids already on stack; keep FIFO; drop overwrite waiter.
