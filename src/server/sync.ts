import "server-only";
import { timingSafeEqual } from "node:crypto";
import { RATE_LIMITED } from "./lichess/ask";
import type { LichessClient } from "./lichess/types";
import type { StoreProvider } from "./provider";

export interface SyncReport {
  /** Matches whose game was looked up on Lichess. */
  checked: number;
  /** Of those, how many had news: a game started, ended, was aborted or needs a referee. */
  changed: number;
  /** Why the pass stopped before looking at every match, if it did. */
  stopped: string | null;
  /** Matches that could not be read this time and will be tried again. */
  failed: number;
}

/**
 * Looks up every game that has a link out and acts on what Lichess says, the way the player's match screen does
 * every few seconds, but without anyone having the page open. A finished game becomes a result, an aborted one
 * counts as not played, and the next waiting time starts.
 *
 * Each match is its own small change, so a slow or failing game does not hold up the others, and a result is
 * saved as soon as it is read. Lichess is asked one game at a time. If Lichess says it is busy (HTTP 429) the pass
 * stops at once and leaves the rest for the next one, because Lichess asks for at least a minute's wait.
 */
export async function readOpenGames(store: StoreProvider, lichess: LichessClient): Promise<SyncReport> {
  const report: SyncReport = { checked: 0, changed: 0, stopped: null, failed: 0 };
  const matchIds = (await store.read()).play.watching();

  for (const matchId of matchIds) {
    const read = await store.update((copy) => copy.play.syncGame(matchId, lichess, new Date()));
    report.checked += 1;
    if (!read.ok) {
      report.failed += 1;
      if (read.error === RATE_LIMITED) {
        report.stopped = read.error;
        break;
      }
      continue;
    }
    if (read.changed) report.changed += 1;
  }
  return report;
}

/** Whether a request carries the shared secret, as `Authorization: Bearer <secret>`. Never true without a secret. */
export function hasSecret(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
