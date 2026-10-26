import "server-only";
import { getLichess } from "./lichess";
import { explain } from "./lichess/ask";
import { LichessRateLimited, type LichessClient, type StandingRow, type SwissInfo } from "./lichess/types";

/** How the Swiss stood when Lichess was last asked. */
export interface SwissReading {
  info: SwissInfo;
  /** Empty before the Swiss starts. */
  standings: StandingRow[];
  readAt: Date;
}

export type SwissRead =
  | {
      ok: true;
      reading: SwissReading;
      /** Why the reading is not up to date, when Lichess could not be asked just now. Null if it is current. */
      late: string | null;
    }
  | { ok: false; error: string };

export interface FeedTimes {
  /** How long a reading of a running Swiss is used before Lichess is asked again. */
  fresh: number;
  /** The same for a finished Swiss, which no longer changes. */
  finished: number;
  /** How long to leave Lichess alone after it said HTTP 429. Its rule is at least a minute. */
  rateLimited: number;
  /** How long to leave it alone after any other failure. */
  failed: number;
}

/** Milliseconds. The real Lichess is asked at most about three times a minute however many people look. */
export const LIVE_TIMES: FeedTimes = { fresh: 20_000, finished: 300_000, rateLimited: 60_000, failed: 10_000 };
/** The stand-in Lichess costs nothing, so it is asked every time and changes show at once. */
export const MOCK_TIMES: FeedTimes = { fresh: 0, finished: 0, rateLimited: 0, failed: 0 };

interface Entry {
  reading?: SwissReading;
  /** When `reading` was taken, on the feed's clock. */
  takenAt?: number;
  /** Leave Lichess alone until then. */
  holdUntil?: number;
  /** Why the last attempt failed. */
  error?: string;
}

/**
 * The live Swiss for the pages that show it. Many people look at those pages at once, and Lichess asks to be
 * left alone after a 429, so a reading is shared: pages use the last one for a few seconds, the people who
 * arrive during a read wait for that same read, and after a failure Lichess is left alone for a while and the
 * last good reading is shown, marked as late.
 *
 * This is for showing only. Building the bracket reads the final standings from Lichess itself, never from here.
 */
export class SwissFeed {
  private readonly entries = new Map<string, Entry>();
  private readonly reading = new Map<string, Promise<SwissRead>>();

  constructor(
    private readonly lichess: LichessClient,
    private readonly times: FeedTimes = lichess.live ? LIVE_TIMES : MOCK_TIMES,
    private readonly clock: () => number = Date.now,
  ) {}

  /** `entrants` is for the stand-in Lichess, which invents standings for them. The real one ignores it. */
  read(swissId: string, entrants: string[] = []): Promise<SwissRead> {
    const entry = this.entries.get(swissId);
    const now = this.clock();

    if (entry?.reading && entry.takenAt !== undefined) {
      const age = now - entry.takenAt;
      const limit = entry.reading.info.status === "finished" ? this.times.finished : this.times.fresh;
      if (age < limit) return Promise.resolve({ ok: true, reading: entry.reading, late: null });
    }
    if (entry?.holdUntil !== undefined && now < entry.holdUntil) return Promise.resolve(this.fallback(entry));

    let pending = this.reading.get(swissId);
    if (!pending) {
      pending = this.fetch(swissId, entrants).finally(() => this.reading.delete(swissId));
      this.reading.set(swissId, pending);
    }
    return pending;
  }

  private async fetch(swissId: string, entrants: string[]): Promise<SwissRead> {
    const entry = this.entries.get(swissId) ?? {};
    this.entries.set(swissId, entry);
    try {
      const info = await this.lichess.getSwiss(swissId);
      if (!info) throw new NoSuchSwiss();
      // Before the first round there is nothing to rank, so that read is saved.
      const standings = info.status === "created" ? [] : await this.lichess.getSwissStandings({ swissId, entrants });
      entry.reading = { info, standings, readAt: new Date(this.clock()) };
      entry.takenAt = this.clock();
      entry.holdUntil = undefined;
      entry.error = undefined;
      return { ok: true, reading: entry.reading, late: null };
    } catch (error) {
      const wait = error instanceof LichessRateLimited ? this.times.rateLimited : this.times.failed;
      entry.holdUntil = this.clock() + wait;
      entry.error = error instanceof NoSuchSwiss ? error.message : explain(error);
      return this.fallback(entry);
    }
  }

  private fallback(entry: Entry): SwissRead {
    const error = entry.error ?? "Could not read the Swiss from Lichess.";
    return entry.reading ? { ok: true, reading: entry.reading, late: error } : { ok: false, error };
  }
}

class NoSuchSwiss extends Error {
  constructor() {
    super("Lichess has no Swiss with that id any more. Choose it again.");
  }
}

// Kept on globalThis so dev-server reloads and separate route bundles share one feed, as they share one Lichess.
const holder = globalThis as unknown as { __castleConnectSwissFeed?: { lichess: LichessClient; feed: SwissFeed } };

export function getSwissFeed(): SwissFeed {
  const lichess = getLichess();
  if (holder.__castleConnectSwissFeed?.lichess !== lichess) {
    holder.__castleConnectSwissFeed = { lichess, feed: new SwissFeed(lichess) };
  }
  return holder.__castleConnectSwissFeed.feed;
}
