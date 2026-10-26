import { LichessError, LichessRateLimited } from "./types";

/** What a person is told when Lichess answers HTTP 429. Lichess asks for at least a minute's wait. */
export const RATE_LIMITED = "Lichess is busy. Try again in a minute.";

/** Runs a Lichess call and turns any failure into a message a person can act on. */
export async function ask<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (error instanceof LichessRateLimited) return { ok: false, error: RATE_LIMITED };
    if (error instanceof LichessError) return { ok: false, error: "Lichess did not answer as expected. Try again in a moment." };
    return { ok: false, error: "Could not reach Lichess. Try again in a moment." };
  }
}
