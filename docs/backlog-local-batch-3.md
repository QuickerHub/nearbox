# Next-hour backlog (after opt/local-batch-3)

Branched from `opt/local-batch-2` (#2) because the permission-queue UI count needs the FIFO queue.

Shipped in this batch: `run-start` failure taxonomy helpers + tests, permission-queue remaining count in the ask UI, streaming answer Markdown split (sealed blocks + open tail), README warm-fallback / permission-queue drift pass.

## Next ideas (title + why)

1. **Snapshot diffing for WS broadcasts** — full HostSnapshot on every coalesced change is still heavy on phone LAN; needs a patch protocol design (not a drive-by).
2. **Warm session-first model discovery** — still in #1 (`opt/local-batch-1`); opens/loads the session before mapping a model chip so the first turn stays warm. Merge #1 after or alongside #2/#3.
3. **Decide remote desktop (0010)** — decision record already pending; do not expand product until product picks narrow/keep/remove.
4. **Session-scoped force-cancel** — if ACP gains one, replace the remaining sole-user host kill after cancel grace.
5. **Memo sealed Markdown blocks** — streaming split helps; `React.memo` on sealed block nodes would cut work further when the sealed prefix is unchanged by reference.
6. **Remote preflight taxonomy tests** — mirror `run-start` helpers for ssh/device/agent-missing paths.

