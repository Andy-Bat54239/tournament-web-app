/**
 * How big the field is decides the format and the cut-off (brief, section 5).
 *
 *   17 to 32 players: 5 Swiss rounds, top 16 advance
 *   33 to 64 players: 6 Swiss rounds (assumed), top 32 advance
 *   up to 16 players: straight knockout, no Swiss (suggested default, open decision)
 */

import { bracketSize } from "./bracket";
import { HARD_CAP } from "./registration";

export const STRAIGHT_KNOCKOUT_MAX = 16;

export interface FormatPlan {
  kind: "knockout_only" | "swiss_knockout";
  swissRounds: number;
  qualifiers: number;
  knockoutRounds: number;
}

/** Null when there are too few players to run anything. */
export function planFormat(players: number): FormatPlan | null {
  if (players > HARD_CAP) throw new RangeError(`The cap is ${HARD_CAP} players.`);
  if (players < 2) return null;

  const make = (kind: FormatPlan["kind"], swissRounds: number, qualifiers: number): FormatPlan => ({
    kind,
    swissRounds,
    qualifiers,
    knockoutRounds: Math.log2(bracketSize(qualifiers)),
  });

  if (players <= STRAIGHT_KNOCKOUT_MAX) return make("knockout_only", 0, players);
  if (players <= 32) return make("swiss_knockout", 5, 16);
  return make("swiss_knockout", 6, 32);
}

export interface Seedable {
  username: string;
  rating: number | null;
  joinedAt: string;
}

/**
 * Seeding for a straight knockout, where there is no Swiss to rank players:
 * highest Lichess blitz rating first, new players last, then sign-up order.
 */
export function seedByRating<T extends Seedable>(players: readonly T[]): T[] {
  return [...players].sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      a.joinedAt.localeCompare(b.joinedAt) ||
      a.username.localeCompare(b.username),
  );
}
