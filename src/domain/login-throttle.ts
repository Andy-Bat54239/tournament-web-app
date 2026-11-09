/**
 * Slowing down someone who keeps guessing the super admin's password.
 *
 * Wrong guesses are counted per source (a scrambled form of the caller's address, never the address itself). The
 * first few are free, because people mistype. After that each wrong guess locks that source out for twice as long as
 * the one before, up to a quarter of an hour. A right password clears the count. A lock is per source, so a stranger
 * who keeps guessing does not lock the real super admin out from somewhere else.
 */

export interface Tries {
  /** Wrong guesses in a row. */
  failures: number;
  /** When the lock ends, as an ISO time. Null when there is none. */
  lockedUntil: string | null;
  /** When the last wrong guess was. */
  last: string;
}

export type Attempts = Record<string, Tries>;

/** Wrong guesses that are let through without a lock. */
export const FREE_TRIES = 4;
export const FIRST_LOCK_MS = 30_000;
export const LONGEST_LOCK_MS = 15 * 60_000;
/** A source that has been quiet this long is forgotten. */
export const FORGET_AFTER_MS = 24 * 60 * 60_000;
/** The most sources kept, so a flood from many addresses cannot make the saved state grow without end. */
export const MOST_SOURCES = 200;

/** How many milliseconds are left on this source's lock, 0 if it may try now. */
export function lockedFor(attempts: Attempts, key: string, now: Date): number {
  const until = attempts[key]?.lockedUntil;
  return until ? Math.max(Date.parse(until) - now.getTime(), 0) : 0;
}

/** The lock a wrong guess number `failures` earns: none while they are free, then 30 s, 1 min, 2 min and so on. */
export function lockAfter(failures: number): number {
  if (failures <= FREE_TRIES) return 0;
  return Math.min(FIRST_LOCK_MS * 2 ** (failures - FREE_TRIES - 1), LONGEST_LOCK_MS);
}

function prune(attempts: Attempts, now: Date): Attempts {
  const alive = Object.entries(attempts).filter(([, t]) => now.getTime() - Date.parse(t.last) < FORGET_AFTER_MS);
  alive.sort(([, a], [, b]) => Date.parse(b.last) - Date.parse(a.last));
  return Object.fromEntries(alive.slice(0, MOST_SOURCES));
}

/** The attempts after one more wrong guess, and the lock it earned (0 for none). Does not change what it is given. */
export function afterFailure(attempts: Attempts, key: string, now: Date): { attempts: Attempts; lockedMs: number } {
  const failures = (attempts[key]?.failures ?? 0) + 1;
  const lockedMs = lockAfter(failures);
  const entry: Tries = {
    failures,
    lockedUntil: lockedMs > 0 ? new Date(now.getTime() + lockedMs).toISOString() : null,
    last: now.toISOString(),
  };
  return { attempts: prune({ ...attempts, [key]: entry }, now), lockedMs };
}

/** The attempts after a right password: this source starts again from nothing. */
export function afterSuccess(attempts: Attempts, key: string): Attempts {
  if (!(key in attempts)) return attempts;
  const rest = { ...attempts };
  delete rest[key];
  return rest;
}

/** "30 seconds", "1 minute", "5 minutes": rounded up, so it is never too short. */
export function waitText(ms: number): string {
  const seconds = Math.max(Math.ceil(ms / 1000), 1);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
