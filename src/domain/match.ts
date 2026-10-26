/**
 * One knockout match between two players, identified by seed. "hi" is the
 * higher Swiss seed (the smaller number), "lo" the lower.
 *
 * Format (brief, section 5): two games, one per colour. Level after two, game 3
 * decides. If game 3 is drawn, games 4 and 5 are played. Still level after
 * game 5, the higher seed advances. The higher seed has White in game 1
 * (assumption to confirm) and colours alternate every game.
 */

export type Side = "hi" | "lo";
export type GameOutcome = Side | "draw";

export interface Game {
  outcome: GameOutcome;
  source: "lichess" | "organizer";
  /** Lichess game id, when the result was read automatically. */
  lichessId?: string;
  /** Required when an organizer set the result by hand. */
  reason?: string;
}

export const MAX_GAMES = 5;

export type MatchPhase = "regulation" | "decider" | "tiebreak";

export interface NextGame {
  game: number;
  white: Side;
  phase: MatchPhase;
}

export interface MatchScore {
  hi: number;
  lo: number;
  played: number;
  winner: Side | null;
  decidedBy: "score" | "higher_seed" | null;
  next: NextGame | null;
}

export function whiteInGame(game: number): Side {
  return game % 2 === 1 ? "hi" : "lo";
}

function phaseOf(game: number): MatchPhase {
  if (game <= 2) return "regulation";
  if (game === 3) return "decider";
  return "tiebreak";
}

/** A match can only be decided after game 2, 3 or 5. */
function decidesAfter(played: number): boolean {
  return played === 2 || played === 3 || played === 5;
}

export function scoreMatch(games: readonly Game[]): MatchScore {
  if (games.length > MAX_GAMES) {
    throw new RangeError(`A match has at most ${MAX_GAMES} games.`);
  }

  let hi = 0;
  let lo = 0;
  let winner: Side | null = null;
  let decidedBy: MatchScore["decidedBy"] = null;

  for (const [i, game] of games.entries()) {
    if (winner) throw new Error("Games were recorded after the match was decided.");
    if (game.outcome === "hi") hi += 1;
    else if (game.outcome === "lo") lo += 1;
    else {
      hi += 0.5;
      lo += 0.5;
    }

    const played = i + 1;
    if (!decidesAfter(played)) continue;
    if (hi !== lo) {
      winner = hi > lo ? "hi" : "lo";
      decidedBy = "score";
    } else if (played === MAX_GAMES) {
      winner = "hi";
      decidedBy = "higher_seed";
    }
  }

  const played = games.length;
  const next: NextGame | null = winner
    ? null
    : { game: played + 1, white: whiteInGame(played + 1), phase: phaseOf(played + 1) };

  return { hi, lo, played, winner, decidedBy, next };
}

/** Plain-language reason the next game is being played, for the match screen. */
export function nextGameNote(score: MatchScore): string {
  if (!score.next) return "";
  switch (score.next.game) {
    case 3:
      return "Tied after two games, so game 3 decides.";
    case 4:
      return "Still level, so two more games.";
    case 5:
      return "Last game. If it ends level, the higher seed advances.";
    default:
      return "";
  }
}
