/**
 * Turns a bracket plus recorded results into who plays whom and who has
 * advanced. The bracket is "rolling": a match becomes ready the moment both of
 * its feeder matches are decided, without waiting for the rest of the round.
 */

import type { Bracket, BracketMatch, Slot } from "./bracket";
import { scoreMatch, type Game, type GameOutcome, type MatchScore } from "./match";

export interface Override {
  /** Who advances: the higher seed, the lower seed, or neither (both out). */
  outcome: "hi" | "lo" | "none";
  kind: "no_show" | "double_no_show" | "organizer";
  reason: string;
  by: string;
  /** ISO timestamp. */
  at: string;
}

export interface MatchRecord {
  /** [higher seed, lower seed] when the record was made. */
  sides: [number, number];
  games: Game[];
  override?: Override;
}

export type SlotState =
  | { status: "player"; seed: number }
  | { status: "pending" }
  | { status: "empty" };

export type DecidedBy =
  | "score"
  | "higher_seed"
  | "no_show"
  | "double_no_show"
  | "organizer"
  | "walkover"
  | "empty";

export type MatchStatus = "waiting" | "ready" | "in_progress" | "decided";

export interface ResolvedMatch {
  id: string;
  round: number;
  title: string;
  a: SlotState;
  b: SlotState;
  hi: number | null;
  lo: number | null;
  status: MatchStatus;
  /** Seed of the player who advances, if any. */
  winner: number | null;
  decidedBy: DecidedBy | null;
  score: MatchScore | null;
  /** A record exists for different players than the ones now in this match, so it was ignored. */
  stale: boolean;
}

export interface ResolvedBracket {
  matches: Record<string, ResolvedMatch>;
  /** Winner of the final, once decided. Always provisional until the fair-play window closes. */
  champion: number | null;
}

type Records = Readonly<Record<string, MatchRecord>>;

function slotState(slot: Slot, matches: Record<string, ResolvedMatch>): SlotState {
  if (slot.kind === "seed") return { status: "player", seed: slot.seed };
  if (slot.kind === "bye") return { status: "empty" };
  const feeder = matches[slot.from];
  if (feeder.status !== "decided") return { status: "pending" };
  return feeder.winner === null
    ? { status: "empty" }
    : { status: "player", seed: feeder.winner };
}

function resolveMatch(
  match: BracketMatch,
  isFinal: boolean,
  records: Records,
  matches: Record<string, ResolvedMatch>,
): ResolvedMatch {
  const a = slotState(match.a, matches);
  const b = slotState(match.b, matches);
  const base = {
    id: match.id,
    round: match.round,
    title: match.title,
    a,
    b,
    hi: null,
    lo: null,
    winner: null,
    decidedBy: null,
    score: null,
    stale: false,
  } satisfies Omit<ResolvedMatch, "status">;

  if (a.status === "pending" || b.status === "pending") {
    return { ...base, status: "waiting" };
  }
  if (a.status !== "player" || b.status !== "player") {
    // At most one player is left: they walk over, or nobody advances.
    const lone = a.status === "player" ? a : b.status === "player" ? b : null;
    return lone
      ? { ...base, status: "decided", winner: lone.seed, decidedBy: "walkover" }
      : { ...base, status: "decided", decidedBy: "empty" };
  }

  const hi = Math.min(a.seed, b.seed);
  const lo = Math.max(a.seed, b.seed);
  const seedOf = { hi, lo };
  const withPlayers = { ...base, hi, lo };

  const record = records[match.id];
  if (!record) return { ...withPlayers, status: "ready" };
  if (record.sides[0] !== hi || record.sides[1] !== lo) {
    return { ...withPlayers, status: "ready", stale: true };
  }

  const { override } = record;
  if (override) {
    if (override.outcome === "none") {
      // Neither showed. Both are out, except in the final, where the higher seed wins.
      return isFinal
        ? { ...withPlayers, status: "decided", winner: hi, decidedBy: "double_no_show" }
        : { ...withPlayers, status: "decided", decidedBy: "double_no_show" };
    }
    return {
      ...withPlayers,
      status: "decided",
      winner: seedOf[override.outcome],
      decidedBy: override.kind,
    };
  }

  const score = scoreMatch(record.games);
  if (score.winner) {
    return {
      ...withPlayers,
      status: "decided",
      winner: seedOf[score.winner],
      decidedBy: score.decidedBy,
      score,
    };
  }
  return {
    ...withPlayers,
    status: record.games.length > 0 ? "in_progress" : "ready",
    score,
  };
}

export function resolveBracket(bracket: Bracket, records: Records): ResolvedBracket {
  const matches: Record<string, ResolvedMatch> = {};
  for (const round of bracket.rounds) {
    for (const match of round) {
      matches[match.id] = resolveMatch(match, match.id === bracket.finalId, records, matches);
    }
  }
  const final = matches[bracket.finalId];
  return { matches, champion: final.status === "decided" ? final.winner : null };
}

/** Matches that are ready or in progress, in bracket order. */
export function openMatches(bracket: Bracket, resolved: ResolvedBracket): ResolvedMatch[] {
  return bracket.rounds
    .flat()
    .map((m) => resolved.matches[m.id])
    .filter((m) => m.status === "ready" || m.status === "in_progress");
}

function requireOpen(match: ResolvedMatch): [number, number] {
  if (match.status === "decided") throw new Error("This match is already decided.");
  if (match.status === "waiting") throw new Error("This match is still waiting for earlier matches.");
  if (match.hi === null || match.lo === null) {
    throw new Error("Both players must be known before a result can be recorded.");
  }
  return [match.hi, match.lo];
}

export function withGame(
  match: ResolvedMatch,
  record: MatchRecord | undefined,
  game: Game,
): MatchRecord {
  const sides = requireOpen(match);
  const current = record && !match.stale ? record : { sides, games: [] };
  return { ...current, sides, games: [...current.games, game] };
}

export function withOverride(
  match: ResolvedMatch,
  record: MatchRecord | undefined,
  override: Override,
): MatchRecord {
  const sides = requireOpen(match);
  const current = record && !match.stale ? record : { sides, games: [] };
  return { ...current, sides, override };
}

/**
 * Undo the most recent change to a match: its override if it has one,
 * otherwise its last game. Returns null when nothing is left to undo.
 */
export function withUndo(record: MatchRecord | undefined): MatchRecord | null {
  if (!record) return null;
  if (record.override) {
    return record.games.length > 0 ? { sides: record.sides, games: record.games } : null;
  }
  const games = record.games.slice(0, -1);
  return games.length > 0 ? { ...record, games } : null;
}

export interface NoShowInput {
  hiPresent: boolean;
  loPresent: boolean;
  isFinal: boolean;
  reason: string;
  by: string;
  at: string;
}

/**
 * No-show rules (brief, section 6). One player shows: that player wins,
 * whatever their seed. Neither shows: both are knocked out, and the opponent
 * waiting in the next round advances. Final only: the higher seed wins.
 */
export function noShowOverride(input: NoShowInput): Override {
  const { hiPresent, loPresent, isFinal, ...meta } = input;
  if (hiPresent !== loPresent) {
    return { ...meta, outcome: hiPresent ? "hi" : "lo", kind: "no_show" };
  }
  if (hiPresent && loPresent) {
    throw new Error("Both players showed, so there is no no-show to record.");
  }
  return { ...meta, outcome: isFinal ? "hi" : "none", kind: "double_no_show" };
}

export function organizerOverride(
  outcome: "hi" | "lo",
  meta: Pick<Override, "reason" | "by" | "at">,
): Override {
  return { ...meta, outcome, kind: "organizer" };
}

export function organizerGame(outcome: GameOutcome, reason: string): Game {
  return { outcome, source: "organizer", reason };
}
