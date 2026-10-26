import "server-only";
import { planFormat } from "@/domain/format";
import { field, type Result } from "@/domain/registration";
import { swissProgress } from "@/domain/swiss";
import { ask } from "./lichess/ask";
import type { LichessClient, StandingRow } from "./lichess/types";
import type { Store } from "./store";

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
  return { ok: true, standings: standings.value };
}
