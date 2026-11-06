import { useEffect, useRef } from "react";
import { api } from "./api";

/** Opens an EventSource for the run; EventSource reconnects itself after errors. Closed on unmount/runId change. */
export function useRunEvents(runId: string | undefined, onEvent: () => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    if (!runId || typeof EventSource === "undefined") return;
    const es = new EventSource(api.eventsUrl(runId));
    es.onmessage = () => ref.current();
    return () => es.close();
  }, [runId]);
}
