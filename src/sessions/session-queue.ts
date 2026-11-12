/**
 * Per-session request queues (chat-on-steroids principle: one chat, one
 * execution lane). Requests for the SAME sessionKey run strictly one after
 * the other; requests for DIFFERENT sessionKeys run in parallel. A failing
 * request never poisons its session's lane.
 */
export class SessionQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Runs fn serialized per key; keys are independent lanes. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) || Promise.resolve();
    const run = tail.then(fn, fn); // a failed predecessor must not block us
    // Keep the lane alive regardless of success/failure.
    this.tails.set(
      key,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    // Housekeeping: drop finished lanes so the map cannot grow unbounded.
    void run
      .catch(() => {})
      .then(() => {
        if (this.tails.get(key) === undefined) return;
      });
    return run;
  }

  /** True when at least one request is queued/running for the key. */
  isBusy(key: string): boolean {
    return this.tails.has(key);
  }
}
