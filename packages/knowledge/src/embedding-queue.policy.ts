/**
 * Serializes work that the runtime can only perform one call at a time.
 *
 * The managed local runtime hosts a single embedding model and serves one
 * request at a time. Two indexing jobs that reach it together make one of
 * them fail with an opaque runtime error, even though each request is valid
 * on its own. Running the calls one after another turns that failure into
 * ordinary waiting.
 *
 * The queue is fair in arrival order: a call that waits behind others still
 * runs, and a rejected call never blocks the ones behind it.
 */
export interface SerialQueue {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> | null = null;
  return {
    run: <T>(work: () => Promise<T>): Promise<T> => {
      const previous = tail;
      // An idle queue starts the work right away, so a lone call is not
      // delayed by a scheduling turn. A busy queue waits for the call in
      // front of it; the work runs whether that call succeeded or failed, so
      // one failure never blocks the ones behind it.
      const started = previous === null ? (async () => work())() : previous.then(work, work);
      const settled = started.then(() => undefined, () => undefined);
      tail = settled;
      void settled.then(() => { if (tail === settled) tail = null; });
      return started;
    }
  };
}
