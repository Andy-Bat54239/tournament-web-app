/**
 * Knockout bracket structure: who plays whom, and where the winners go.
 * Pure data, no results. See knockout.ts for resolving results into winners.
 */

export type Slot =
  | { kind: "seed"; seed: number }
  | { kind: "bye" }
  | { kind: "winner"; from: string };

export interface BracketMatch {
  id: string;
  /** 1 = first round. */
  round: number;
  /** 0-based position within the round. */
  index: number;
  title: string;
  a: Slot;
  b: Slot;
}

export interface Bracket {
  /** Power of two at least as large as the number of qualifiers. */
  size: number;
  qualifiers: number;
  rounds: BracketMatch[][];
  finalId: string;
}

export function bracketSize(qualifiers: number): number {
  if (!Number.isInteger(qualifiers) || qualifiers < 2) {
    throw new RangeError("A bracket needs at least 2 qualifiers.");
  }
  let size = 2;
  while (size < qualifiers) size *= 2;
  return size;
}

/**
 * Seeds in bracket order, two by two. For 16 this is
 * 1,16, 8,9, 4,13, 5,12, 2,15, 7,10, 3,14, 6,11, so top seeds only meet late.
 */
export function seedOrder(size: number): number[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError("Bracket size must be a power of two, at least 2.");
  }
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, sum - seed]);
  }
  return order;
}

/** Name of a round, from the number of players still in it. */
export function roundTitle(size: number, round: number): string {
  const playersLeft = size / 2 ** (round - 1);
  if (playersLeft === 2) return "Final";
  if (playersLeft === 4) return "Semifinals";
  if (playersLeft === 8) return "Quarterfinals";
  return `Round of ${playersLeft}`;
}

function matchTitle(size: number, round: number, index: number): string {
  const playersLeft = size / 2 ** (round - 1);
  if (playersLeft === 2) return "Final";
  if (playersLeft === 4) return `Semifinal ${index + 1}`;
  if (playersLeft === 8) return `Quarterfinal ${index + 1}`;
  return `Round of ${playersLeft}, match ${index + 1}`;
}

export function matchId(round: number, index: number): string {
  return `r${round}m${index + 1}`;
}

/**
 * Builds the bracket for a number of qualifiers (seeded 1..qualifiers).
 * When the field is not a power of two, the missing seeds become byes, so the
 * top seeds skip the first round.
 */
export function buildBracket(qualifiers: number): Bracket {
  const size = bracketSize(qualifiers);
  const order = seedOrder(size);
  const totalRounds = Math.log2(size);
  const slotFor = (seed: number): Slot =>
    seed <= qualifiers ? { kind: "seed", seed } : { kind: "bye" };

  const rounds: BracketMatch[][] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const matches: BracketMatch[] = [];
    for (let index = 0; index < size / 2 ** round; index++) {
      const previous = rounds[round - 2];
      matches.push({
        id: matchId(round, index),
        round,
        index,
        title: matchTitle(size, round, index),
        a: previous
          ? { kind: "winner", from: previous[index * 2].id }
          : slotFor(order[index * 2]),
        b: previous
          ? { kind: "winner", from: previous[index * 2 + 1].id }
          : slotFor(order[index * 2 + 1]),
      });
    }
    rounds.push(matches);
  }

  return { size, qualifiers, rounds, finalId: rounds[totalRounds - 1][0].id };
}
