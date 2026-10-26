import "server-only";
import { cutOff, type CutView } from "@/domain/cutoff";
import { planFormat } from "@/domain/format";
import { field, type Result } from "@/domain/registration";
import { roundsLeft, swissProgress } from "@/domain/swiss";
import { ask } from "./lichess/ask";
import type { LichessClient, StandingRow } from "./lichess/types";
import type { Store } from "./store";
import type { SwissFeed } from "./swiss-feed";

const fail = (error: string) => ({ ok: false, error }) as const;

/**
 * The final Swiss ranks the bracket is built from, read from Lichess. The app never works out ranks itself:
 * Lichess has already applied its tiebreak. Standings are only given once the Swiss has finished, because
 * building the bracket from a Swiss still under way would seed the wrong players.
 *
 * `standings` is null when none are needed, which is a straight knockout seeded by rating. With the stand-in
 * Lichess (`live` is false) no Swiss has to be chosen, and the standings are invented.
 */
export async function standingsFor(store: Store, lichess: LichessClient): Promise<Result<{ standings: StandingRow[] | null }>> {
  const players = field(store.registrations);
  const plan = planFormat(players.length);
  if (!plan || plan.kind === "knockout_only") return { ok: true, standings: null };

  const swissId = store.tournament.swissId;
  if (!swissId && lichess.live) return fail("Choose the Lichess Swiss first: paste its link in the box above.");

  if (swissId) {
    const info = await ask(() => lichess.getSwiss(swissId));
    if (!info.ok) return info;
    if (!info.value) return fail("Lichess has no Swiss with that id any more. Choose it again.");
    if (info.value.status !== "finished") {
      return fail(`The Swiss is not finished yet (${swissProgress(info.value).toLowerCase()}). Build the bracket when it ends.`);
    }
  }

  const standings = await ask(() => lichess.getSwissStandings({ swissId, entrants: players.map((p) => p.username) }));
  if (!standings.ok) return standings;
  if (standings.value.length === 0) return fail("Lichess returned no standings for that Swiss.");
  const entered = new Set(standings.value.map((s) => s.username.toLowerCase()));
  if (!players.some((p) => entered.has(p.username.toLowerCase()))) {
    return fail("None of the checked-in players are in that Swiss. Check that you chose the right one.");
  }
  return { ok: true, standings: standings.value };
}

/** What the Swiss pages show. */
export type SwissStandings =
  /** A straight knockout: there is no Swiss. */
  | { kind: "none" }
  /** A Swiss is needed and none has been chosen. */
  | { kind: "choose" }
  /** Lichess could not be asked, and there is no earlier reading to show. */
  | { kind: "unavailable"; error: string }
  | {
      kind: "table";
      /** The Swiss's name on Lichess. Null for the final standings kept when the bracket was built. */
      name: string | null;
      /** Where the Swiss has got to, in words. */
      progress: string;
      view: CutView;
      /** When Lichess was last read. Null for the standings kept in the bracket. */
      readAt: Date | null;
      /** Why this is an earlier reading, when Lichess could not be asked just now. */
      late: string | null;
    };

/** The id the stand-in Lichess answers to when no Swiss has been chosen. */
const SIMULATED_SWISS = "simulated";

/**
 * The Swiss for the public page and the organizer, with the cut-off line and the bubble.
 *
 * Once the bracket is built, the standings kept with it are shown and Lichess is not asked again. Before that
 * they are read live, through the shared feed, and only the players in the tournament are listed: someone who
 * joined the Swiss on Lichess without signing up here cannot qualify, and is left out as the bracket leaves them out.
 */
export async function swissStandings(store: Store, lichess: LichessClient, feed: SwissFeed): Promise<SwissStandings> {
  const { bracket, qualifiers, swiss, swissId } = store.tournament;

  if (bracket && qualifiers && swiss) {
    // Players ranked above the last qualifier who did not qualify were not in the tournament.
    const lastRank = qualifiers[qualifiers.length - 1].swissRank;
    const qualified = new Set(qualifiers.map((q) => q.username.toLowerCase()));
    const rows = swiss.filter((s) => qualified.has(s.username.toLowerCase()) || lastRank === null || s.rank > lastRank);
    return {
      kind: "table",
      name: null,
      progress: "Final standings",
      view: cutOff(rows, qualifiers.length, { roundsLeft: 0 }),
      readAt: null,
      late: null,
    };
  }

  const players = field(store.registrations);
  const plan = planFormat(players.length);
  if (!plan || plan.kind === "knockout_only") return { kind: "none" };

  const id = swissId ?? (lichess.live ? null : SIMULATED_SWISS);
  if (!id) return { kind: "choose" };

  const read = await feed.read(
    id,
    players.map((p) => p.username),
  );
  if (!read.ok) return { kind: "unavailable", error: read.error };

  const { info, standings, readAt } = read.reading;
  const entered = new Set(players.map((p) => p.username.toLowerCase()));
  return {
    kind: "table",
    name: info.name,
    progress: swissProgress(info),
    view: cutOff(
      standings.filter((s) => entered.has(s.username.toLowerCase())),
      plan.qualifiers,
      { roundsLeft: roundsLeft(info) },
    ),
    readAt,
    late: read.late,
  };
}
