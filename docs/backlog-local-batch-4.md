# Next-hour backlog (after opt/local-batch-4)

Branched from `opt/local-batch-3` (#3) so sealed-markdown memo and force-cancel sit on the FIFO permission queue + streaming MD split.

Shipped in this batch: memoised sealed Markdown tree, remote preflight helpers + SSH explain/path guards extracted for `node --test`, ACP `$/cancel_request` force-cancel before sole-user host kill, string JSON-RPC response ids.

## Skipped this batch

- **Snapshot diffing for WS broadcasts** — still needs a patch protocol (`HostToClient` + client merge). Full snapshots are coalesced already; a drive-by patch risks phone UI desync. Design first (fields that change often vs cold), keep `ready` as full snapshot, optional `snapshot-patch` only for hot paths. Discover/`nearbox://` stay untouched.

## Next ideas (title + why)

1. **Warm session-first model discovery** — still in #1 (`opt/local-batch-1`); opens/loads the session before mapping a model chip so the first turn stays warm. Merge #1 after or alongside #2→#3→#4; resolve `runner` cancel/permission carefully (keep FIFO from #2, never restore #1 overwrite waiter).
2. **Decide remote desktop (0010)** — decision record already pending; do not expand product until product picks narrow/keep/remove.
3. **`session/close` when advertised** — ACP stabilised `sessionCapabilities.close`; could release idle sessions without killing the host. Separate from turn force-cancel; needs capability probe + idle policy.
4. **WS snapshot patches (designed)** — see skipped note; measure phone LAN payload size under busy runs before inventing diffs.
5. **Locally reject hung prompt after `$/cancel_request`** — if the agent ignores cancel-request past force grace, finish the run without `host.kill()` when other warm sessions exist… already sole-user only kill; shared path finishes early. Optional: reject pending RPC locally so a wedged sole-user host can still be replaced cleanly.
