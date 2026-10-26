/**
 * The cut-off in the Swiss (brief, section 7C): where the line falls and who is close to it.
 *
 * Ranks are Lichess's. The rows are only put in the order Lichess gave them, and nobody is ranked here. What this
 * adds is what Lichess does not say: for each player, whether they are through, out, or still to be decided.
 *
 * It rests on two facts. Points never go down, and nobody scores more than a point a round. So a player is
 * through when too few others can still finish level with them or ahead, and out when enough others are already
 * ahead of the most they can reach. Ties count against the player, because Lichess's tiebreak may go either way.
 */

export interface Ranked {
  /** Lichess's rank, tiebreak already applied. */
  rank: number;
  username: string;
  points: number;
}

/**
 * through: certain to play on.
 * out: cannot reach the line any more.
 * bubble: not decided, and close to the line or level with it.
 * open: not decided, and not near the line.
 */
export type Fate = "through" | "bubble" | "out" | "open";

export interface CutRow extends Ranked {
  /** In a place that plays on, going by the standings as they are now. */
  inside: boolean;
  fate: Fate;
  /** Level on points with the last place inside, with the line between them: only the tiebreak separates them. */
  level: boolean;
}

export interface CutView {
  /** How many places play on. */
  places: number;
  rows: CutRow[];
  /** Points of the last place inside. Null when nobody is cut, because everyone fits. */
  cutPoints: number | null;
  /** Every round has been played, so the standings are final. */
  finished: boolean;
}

/** How many places either side of the line count as close to it. */
export const BUBBLE_SPAN = 3;

/**
 * @param places     how many play on (16, or 32 at 64 players)
 * @param roundsLeft rounds not yet fully played, 0 once the Swiss is over. Too high a number only makes the
 *                   result more careful, so when unsure, say more.
 */
export function cutOff(
  standings: readonly Ranked[],
  places: number,
  { roundsLeft, span = BUBBLE_SPAN }: { roundsLeft: number; span?: number },
): CutView {
  const rows = [...standings].sort((a, b) => a.rank - b.rank);
  const finished = roundsLeft <= 0;
  const left = Math.max(roundsLeft, 0);
  const wanted = Math.max(Math.floor(places), 1); // a cut-off with no places makes no sense
  const cut = Math.min(wanted, rows.length);

  if (cut >= rows.length) {
    // Everyone fits, so there is no line. Until the Swiss is over, someone may still join.
    const fate: Fate = finished ? "through" : "open";
    return {
      places: wanted,
      rows: rows.map((row) => ({ ...row, inside: true, fate, level: false })),
      cutPoints: null,
      finished,
    };
  }

  const cutPoints = rows[cut - 1].points;
  const straddles = rows.some((row, i) => i < cut && row.points === cutPoints) && rows.some((row, i) => i >= cut && row.points === cutPoints);

  return {
    places: cut,
    cutPoints,
    finished,
    rows: rows.map((row, i): CutRow => {
      const others = rows.filter((_, j) => j !== i);
      const ahead = others.filter((o) => o.points > row.points + left).length;
      const rivals = others.filter((o) => o.points + left >= row.points).length;
      const level = straddles && row.points === cutPoints;

      let fate: Fate;
      if (ahead >= cut) fate = "out";
      else if (rivals < cut) fate = "through";
      else if (level || (i >= cut - span && i < cut + span)) fate = "bubble";
      else fate = "open";

      return { ...row, inside: i < cut, fate, level };
    }),
  };
}

const NAME_LIMIT = 8;

/** "Kevin", "Kevin and Joan", "Kevin, Joan and Ivan", and past eight names, "Kevin, Joan, … and 3 more". */
export function nameList(names: readonly string[], limit = NAME_LIMIT): string {
  if (names.length <= limit) {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

/** The sentences under the table. Each is plain text for one paragraph. */
export function cutNotes(view: CutView): string[] {
  const { places, rows, cutPoints, finished } = view;

  if (cutPoints === null) {
    return [
      finished
        ? `Everyone plays on: only ${rows.length} players for ${places} places.`
        : `Nobody is cut so far: ${rows.length} players for ${places} places.`,
    ];
  }

  const names = (pick: (row: CutRow) => boolean) => rows.filter(pick).map((row) => row.username);

  if (finished) {
    const missed = names((r) => r.level && !r.inside);
    const made = names((r) => r.level && r.inside);
    const notes = [`The Swiss is over. The top ${places} play on.`];
    if (missed.length > 0) notes.push(`${nameList(missed)} missed the cut on Lichess’s tiebreak.`);
    if (made.length > 0) notes.push(`${nameList(made)} made it on Lichess’s tiebreak.`);
    return notes;
  }

  const bubble = names((r) => r.fate === "bubble");
  return [
    `The top ${places} play on. The line is at ${cutPoints} point${cutPoints === 1 ? "" : "s"} right now.`,
    bubble.length > 0 ? `On the bubble: ${nameList(bubble)}.` : "Nobody is on the bubble: everyone is through or out.",
  ];
}
