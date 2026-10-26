/**
 * Everything the app needs from Lichess, behind one interface. Only the mock is
 * built so far; the real client waits on the checks in section 8 of the brief
 * (restricted challenge links, game results, Swiss inside a team, rate limits).
 */

export interface LichessProfile {
  username: string;
  /** Blitz rating. Null when Lichess marks it provisional, shown to players as "new". */
  blitzRating: number | null;
  provisional: boolean;
}

export interface StandingRow {
  /** Final rank as Lichess reports it, tiebreaks already applied. Never recomputed here. */
  rank: number;
  username: string;
  points: number;
}

export interface LichessClient {
  /** Null when no such Lichess account exists. */
  getProfile(username: string): Promise<LichessProfile | null>;
  /**
   * Final standings of the team Swiss. The real client reads `swissId` from
   * Lichess and ignores `entrants`; the mock invents standings for them.
   */
  getSwissStandings(input: { swissId: string | null; entrants: string[] }): Promise<StandingRow[]>;
}
