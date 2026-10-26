import { LichessError, LichessRateLimited } from "./types";

/** Runs a Lichess call and turns any failure into a message a person can act on. */
export async function ask<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (error instanceof LichessRateLimited) return { ok: false, error: "Lichess is busy. Try again in a minute." };
    if (error instanceof LichessError) return { ok: false, error: "Lichess did not answer as expected. Try again in a moment." };
    return { ok: false, error: "Could not reach Lichess. Try again in a moment." };
  }
}
