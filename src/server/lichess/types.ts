/**
 * Everything the app needs from Lichess, behind one interface. A mock stands in for development and the
 * HTTP client talks to the real Lichess; both are exercised by docs/lichess-checks.md. Login (OAuth) is not
 * part of this interface yet.
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

/** A challenge only the two named players can join. */
export interface LinkRequest {
  /** The player with White first: Lichess gives the first name listed White. */
  users: [string, string];
  clock: { limit: number; increment: number };
  /** Comma-separated Lichess challenge rules, for example "noRematch,noEarlyDraw". */
  rules: string;
  expiresAt: Date;
  /** Shown to the two players on the challenge page. */
  name: string;
}

export interface GameLink {
  /** The challenge id, which becomes the game id once both players join. */
  id: string;
  /** What to hand to the players. */
  url: string;
}

export interface LichessGame {
  id: string;
  /** Lichess status: created, started, mate, resign, draw, aborted, outoftime, and so on. */
  status: string;
  winner: "white" | "black" | null;
  white: string | null;
  black: string | null;
  /** When a finished game ended. Null while it is still being played. */
  endedAt: Date | null;
}

export interface LichessClient {
  /** Null when no such Lichess account exists. */
  getProfile(username: string): Promise<LichessProfile | null>;
  /**
   * Final standings of the team Swiss. The real client reads `swissId` from
   * Lichess and ignores `entrants`; the mock invents standings for them.
   */
  getSwissStandings(input: { swissId: string | null; entrants: string[] }): Promise<StandingRow[]>;

  /** Creates a restricted open challenge. Anyone not named is refused (checked live). */
  createGameLink(request: LinkRequest): Promise<GameLink>;
  /** True while the link can still be used to start the game: not joined yet, cancelled or expired. */
  isLinkOpen(id: string): Promise<boolean>;
  /** Closes a link nobody should use any more. Safe to call on a link that is already gone. */
  cancelLink(id: string): Promise<void>;
  /** The game made from a link. Null until both players have joined, because no game exists before that. */
  getGame(id: string): Promise<LichessGame | null>;
}

/** Lichess answered, but not with what we expected. */
export class LichessError extends Error {}

/** Lichess answered HTTP 429. Its rule is to wait at least a minute. */
export class LichessRateLimited extends LichessError {}
