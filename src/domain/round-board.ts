/**
 * The organizer's picture of the knockout: every match, where it stands, and what needs someone. Built from the
 * store (see server/round-board.ts); this file holds the shapes and the wording, which need no server.
 */

export type BoardStage =
  /** The players are not known yet, because an earlier match is still going. */
  | "waiting"
  /** The players are known, but the knockout is on hold. */
  | "held"
  /** The players are known and have a waiting time running, and nobody has started the game. */
  | "ready"
  /** Both players have joined the game on Lichess. */
  | "playing"
  /** Someone has to look: a claim, a waiting time that ran out, an odd result, repeated aborts. */
  | "flagged"
  | "decided";

export const STAGES: readonly BoardStage[] = ["flagged", "playing", "ready", "held", "waiting", "decided"];

export interface BoardMatch {
  id: string;
  title: string;
  hi: string | null;
  lo: string | null;
  stage: BoardStage;
  /** One line saying why it is in that stage. */
  note: string;
}

export interface BoardRound {
  round: number;
  title: string;
  matches: BoardMatch[];
}

export interface RoundBoard {
  rounds: BoardRound[];
  held: boolean;
  /** The champion's name once the final is decided. Provisional until the fair-play window closes. */
  champion: string | null;
}

export function countStages(matches: readonly BoardMatch[]): Record<BoardStage, number> {
  const counts: Record<BoardStage, number> = { waiting: 0, held: 0, ready: 0, playing: 0, flagged: 0, decided: 0 };
  for (const match of matches) counts[match.stage] += 1;
  return counts;
}

/** The first round that still has a match to play, or null when every match is decided. */
export function activeRound(board: RoundBoard): BoardRound | null {
  return board.rounds.find((r) => r.matches.some((m) => m.stage !== "decided")) ?? null;
}

/** "2" for two points, "1½" for one and a half, "½" for half a point. */
export function points(value: number): string {
  const whole = Math.floor(value);
  if (Number.isInteger(value)) return String(value);
  return whole === 0 ? "½" : `${whole}½`;
}

const LIST_LIMIT = 6;

function pairs(matches: readonly BoardMatch[]): string {
  const shown = matches.slice(0, LIST_LIMIT).map((m) => `${m.hi} v ${m.lo}`);
  const more = matches.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
}

/**
 * A message for the community chat, like "Quarterfinals are live. 1 of 4 matches are finished. Still waiting to
 * start: Mercy v Kevin, Ivan v Patience." The organizer reads it, picks the group and sends it.
 */
export function roundUpdateText(board: RoundBoard): string {
  if (board.champion) {
    return `The knockout is over. ${board.champion} is the champion (provisional until the fair-play window closes).`;
  }
  const round = activeRound(board);
  if (!round) return "The bracket is built. Open the app to see your match.";

  const done = round.matches.filter((m) => m.stage === "decided").length;
  const total = round.matches.length;
  const plural = round.title.endsWith("s"); // Quarterfinals, Semifinals; but Final, Round of 16
  const toStart = round.matches.filter((m) => m.stage === "ready" || m.stage === "flagged" || m.stage === "held");

  if (board.held) {
    return `The ${round.title} ${plural ? "start" : "starts"} soon: ${pairs(toStart)}. Open the app to see your match.`;
  }
  const counted = done === 0 ? "" : ` ${done} of ${total} matches finished.`;
  const waiting = toStart.length === 0 ? " Every match is under way." : ` Still waiting to start: ${pairs(toStart)}.`;
  return `${round.title} ${plural ? "are" : "is"} live.${counted}${waiting} Open the app to play your match.`;
}
