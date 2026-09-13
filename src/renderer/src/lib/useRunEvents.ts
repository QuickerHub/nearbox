import { useEffect, useState } from "react";
import type { RunEvent } from "@shared/protocol";
import type { ClientHandle } from "./client";
import { mergeCatchUpHistory, queueLiveEvent } from "./liveEvents";

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
      const batch = liveBatch;
      liveBatch = [];
      lastSeq = batch[batch.length - 1]!.seq;
      setEvents((current) => [...(current ?? []), ...batch]);
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
    void client
      .runEvents(runId, 0)
      .then((history) => {
        if (disposed) {
          return;
        }
        const caught = mergeCatchUpHistory(history, buffered);
        lastSeq = caught.lastSeq;
        buffered = [];
        caughtUp = true;
        setEvents(caught.events);
      })
      .catch(() => {
        if (!disposed) {
          caughtUp = true;
          setEvents((current) => current ?? []);
        }
      });
    return () => {
      disposed = true;
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
      unsubscribe();
    };
  }, [client, runId, enabled]);

  return events;
}
