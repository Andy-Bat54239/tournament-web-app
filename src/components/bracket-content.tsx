import { connection } from "next/server";
import { roundTitle } from "@/domain/bracket";
import { readStore } from "@/server/instance";
import { getLichess } from "@/server/lichess";
import { swissStandings } from "@/server/swiss";
import { getSwissFeed } from "@/server/swiss-feed";
import { AutoRefresh } from "./auto-refresh";
import { MatchCard } from "./match-card";
import { SwissTable } from "./swiss-table";

/** How often the public view brings itself up to date, for a phone left open or a projector. */
const REFRESH_MS = 30_000;

/**
 * The public live view: the Swiss while it is being played, then the bracket with the Swiss under it. Reads live
 * state, so use inside <Suspense>.
 */
export async function BracketContent() {
  await connection();
  const store = await readStore();
  const { tournament } = store;
  const resolved = store.resolved();
  const { bracket, qualifiers, records } = tournament;
  const swiss = await swissStandings(store, getLichess(), getSwissFeed());
  const table = (
    <section aria-labelledby="swiss">
      <h2 id="swiss">Swiss standings</h2>
      <SwissTable swiss={swiss} />
    </section>
  );

  if (!bracket || !resolved || !qualifiers) {
    return (
      <>
        {swiss.kind !== "none" && table}
        <div className="card">
          <p className="strong">The bracket is not built yet.</p>
          <p className="note">It appears here once the Swiss ends and the top players are seeded.</p>
        </div>
        <AutoRefresh everyMs={REFRESH_MS} />
      </>
    );
  }

  const champion = resolved.champion;
  return (
    <>
      {champion !== null && (
        <div className="champ">Champion: {qualifiers[champion - 1]?.username} (provisional)</div>
      )}
      {bracket.rounds.map((round, i) => (
        <section key={i} aria-labelledby={`round-${i + 1}`}>
          <h2 id={`round-${i + 1}`}>{roundTitle(bracket.size, i + 1)}</h2>
          {round.map((m) => (
            <MatchCard
              key={m.id}
              match={resolved.matches[m.id]}
              names={qualifiers}
              games={resolved.matches[m.id].stale ? [] : (records[m.id]?.games ?? [])}
              isFinal={m.id === bracket.finalId}
            />
          ))}
        </section>
      ))}
      {swiss.kind !== "none" && table}
      {champion === null && <AutoRefresh everyMs={REFRESH_MS} />}
    </>
  );
}
