/**
 * Playing a knockout match (brief, sections 5 to 7E): the no-show windows, how a Lichess game becomes a
 * result, and when a player may claim a win. Pure rules; the store keeps the state.
 *
 * Grounded in the live Lichess checks (docs/lichess-checks.md): Lichess does not end a game because
 * someone never moves, and an early resignation is recorded as an abort, so the app runs its own clock and
 * treats aborted games as not played.
 */

import { whiteInGame, type GameOutcome, type Side } from "./match";

const MINUTE = 60_000;

/** From the moment the match becomes ready (the round is announced). */
export const FIRST_GAME_WINDOW = 3 * MINUTE;
/** After a game ends. The brief gives this for game 2; it is assumed for games 3 to 5 and for a replayed game. */
export const NEXT_GAME_WINDOW = 2 * MINUTE;
/** Problems are reported within 5 minutes of a game ending. */
export const PROBLEM_WINDOW = 5 * MINUTE;
/** From this many aborts in one match, a referee is asked to look. */
export const REPEATED_ABORTS = 2;

export const GAME_CLOCK = { limit: 300, increment: 2 } as const;
/**
 * Challenge rules switched on for every knockout game. noAbort is for Lichess admins only, so aborts cannot be
 * blocked. noClaimWin is left off, so the clock and Lichess's own claim-victory decide a disconnect.
 */
export const GAME_RULES = "noRematch,noGiveTime,noEarlyDraw";
/** How long an unjoined link stays valid. */
export const LINK_LIFETIME = 20 * MINUTE;

export function windowFor(gameNumber: number): number {
  return gameNumber === 1 ? FIRST_GAME_WINDOW : NEXT_GAME_WINDOW;
}

/** What the store keeps for the game a match is on. Times are ISO strings. */
export interface GameRound {
  /** 1 to 5. A replayed (aborted) game keeps its number. */
  game: number;
  startedAt: string;
  closesAt: string;
  /** When each player tapped "I'm ready". */
  ready: Partial<Record<Side, string>>;
  /** The Lichess challenge for this game, once someone has asked for it. */
  link?: { id: string; url: string; createdAt: string };
  /** A waiting player's claim, awaiting a referee. */
  claim?: { by: Side; at: string };
}

export interface ProblemReport {
  by: string;
  at: string;
  game: number;
  text: string;
  /** Reported more than 5 minutes after the game ended. */
  late: boolean;
}

export interface MatchPlay {
  round: GameRound | null;
  /** Games of this match that Lichess aborted, which count as not played. */
  aborts: number;
  problems: ProblemReport[];
}

export type Classified =
  | { kind: "ongoing" }
  | { kind: "result"; winner: "white" | "black" | null }
  | { kind: "not_played" }
  | { kind: "needs_referee"; reason: string };

const NOT_PLAYED = ["aborted", "noStart"];
const DRAWS = ["draw", "stalemate", "insufficientMaterialClaim"];
const DECISIVE = ["mate", "resign", "timeout", "outoftime", "variantEnd"];

/** Turns a Lichess game status and winner into what the app should do with it. */
export function classifyGame(status: string, winner?: "white" | "black" | null): Classified {
  if (status === "created" || status === "started") return { kind: "ongoing" };
  if (NOT_PLAYED.includes(status)) return { kind: "not_played" };
  if (DRAWS.includes(status)) return { kind: "result", winner: null };
  if (DECISIVE.includes(status) && winner) return { kind: "result", winner };
  return { kind: "needs_referee", reason: `Lichess reported "${status}"${winner ? "" : " with no winner"}.` };
}

/** Which seed won, given the colour that won. White in game 1 is the higher seed, then colours alternate. */
export function outcomeOf(gameNumber: number, winner: "white" | "black" | null): GameOutcome {
  if (winner === null) return "draw";
  const white = whiteInGame(gameNumber);
  const black: Side = white === "hi" ? "lo" : "hi";
  return winner === "white" ? white : black;
}

export function opponentOf(side: Side): Side {
  return side === "hi" ? "lo" : "hi";
}

export function secondsLeft(now: Date, closesAt: Date): number {
  return Math.max(0, Math.ceil((closesAt.getTime() - now.getTime()) / 1000));
}

/** 154 seconds becomes "2:34". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface ClaimCheck {
  now: Date;
  closesAt: Date;
  claimantReady: boolean;
  opponentReady: boolean;
  /** Both players have joined the Lichess game, so nobody is absent. */
  gameStarted: boolean;
}

/** Why a player cannot claim a win yet, or null if they can. */
export function claimProblem(check: ClaimCheck): string | null {
  if (check.gameStarted) return "Your opponent has joined the game. Play it on Lichess.";
  if (!check.claimantReady) return "Tap I’m ready first, so the app knows you were waiting.";
  if (check.now < check.closesAt) return "The waiting time is not over yet.";
  if (check.opponentReady) return "Your opponent is ready. Play the game on Lichess.";
  return null;
}

export function isLate(endedAt: Date | null, reportedAt: Date): boolean {
  return endedAt !== null && reportedAt.getTime() - endedAt.getTime() > PROBLEM_WINDOW;
}
