import "server-only";

/**
 * Runs `task` now and then, for as long as the server is up, and never twice at once: if one run is still going
 * when the next is due, that tick is skipped. A run that fails is logged and the loop carries on. Returns a
 * function that stops it.
 */
export function everySoOften(task: () => Promise<unknown>, everyMs: number, onError: (error: unknown) => void): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }, everyMs);
  // A timer must never be the only thing keeping the process alive.
  timer.unref();
  return () => clearInterval(timer);
}

const MIN_SECONDS = 5;
const DEFAULT_SECONDS = 20;

/** The pause between reads, from SYNC_EVERY_SECONDS: 20 seconds unless set, and never under 5. */
export function syncInterval(value: string | undefined): number {
  const seconds = Number(value);
  return (Number.isFinite(seconds) && seconds > 0 ? Math.max(MIN_SECONDS, seconds) : DEFAULT_SECONDS) * 1000;
}

const holder = globalThis as unknown as { __castleConnectSyncLoop?: () => void };

/**
 * For a server that stays up (a VPS, Fly, Railway, `next start`): BACKGROUND_SYNC=true reads results from
 * Lichess by itself, with no outside caller. It does nothing on serverless hosting, where nothing is left running
 * between requests; use /api/sync there. Safe to call twice.
 */
export function startBackgroundSync(task: () => Promise<unknown>): boolean {
  if (process.env.BACKGROUND_SYNC !== "true" || holder.__castleConnectSyncLoop) return false;
  const everyMs = syncInterval(process.env.SYNC_EVERY_SECONDS);
  holder.__castleConnectSyncLoop = everySoOften(task, everyMs, (error) =>
    console.error("Background reading of results failed:", error),
  );
  console.log(`Reading results from Lichess every ${everyMs / 1000} seconds.`);
  return true;
}
