import { useEffect, useState } from "react";
import type { RunEvent } from "@shared/protocol";
import type { ClientHandle } from "./client";
import { appendCatchUpEvents, drainLiveBatch, mergeCatchUpHistory, queueLiveEvent } from "./liveEvents";

/** Coalesce streamed events so the transcript rebuilds a few times a second, not per token. */
const LIVE_FLUSH_MS = 50;

/**
 * Live event stream for one run. `null` while the history is still loading
 * (or the subscription is off); an empty array once we know there is nothing.
 */
export function useRunEvents(client: ClientHandle, runId: string | undefined, enabled = true): RunEvent[] | null {
  const [events, setEvents] = useState<RunEvent[] | null>(null);

  useEffect(() => {
    if (!runId || !enabled) {
      setEvents(null);
      return;
    }
    let disposed = false;
    let lastSeq = 0;
    let buffered: RunEvent[] = [];
    let liveBatch: RunEvent[] = [];
    let flushTimer: number | null = null;
    let caughtUp = false;
    setEvents(null);

    const flushLive = () => {
      flushTimer = null;
      if (disposed || !liveBatch.length) {
        return;
      }
      const drained = drainLiveBatch(liveBatch);
      lastSeq = drained.lastSeq;
      setEvents((current) => [...(current ?? []), ...drained.events]);
    };

    const applyCatchUp = (history: RunEvent[]) => {
      const caught = mergeCatchUpHistory(history, buffered);
      lastSeq = caught.lastSeq;
      buffered = [];
      caughtUp = true;
      setEvents(caught.events);
    };

    const unsubscribe = client.subscribeRun(runId, (event) => {
      if (disposed) {
        return;
      }
      if (!caughtUp) {
        buffered.push(event);
        return;
      }
      if (!queueLiveEvent(liveBatch, event, lastSeq)) {
        return;
      }
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flushLive, LIVE_FLUSH_MS);
      }
    });

    const unsubscribeReconnect = client.onReconnect(() => {
      if (disposed || !caughtUp) {
        return;
      }
      const after = lastSeq;
      void client
        .runEvents(runId, after)
        .then((more) => {
          if (disposed || !more.length) {
            return;
          }
          // Drop anything the HTTP catch-up already covers from the live batch.
          const covered = new Set(more.map((event) => event.seq));
          let tip = lastSeq;
          for (const event of more) {
            if (event.seq > tip) {
              tip = event.seq;
            }
          }
          lastSeq = tip;
          liveBatch = liveBatch.filter((event) => !covered.has(event.seq) && event.seq > lastSeq);
          setEvents((current) => appendCatchUpEvents(current ?? [], more).events);
        })
        .catch(() => {
          // Keep showing what we have; the next live event or reconnect can retry.
        });
    });

    void client
      .runEvents(runId, 0)
      .then((history) => {
        if (disposed) {
          return;
        }
        applyCatchUp(history);
      })
      .catch(() => {
        if (!disposed) {
          // HTTP catch-up failed; still promote whatever WS already delivered.
          applyCatchUp([]);
        }
      });
    return () => {
      disposed = true;
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [client, runId, enabled]);

  return events;
}
