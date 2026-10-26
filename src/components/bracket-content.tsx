import { connection } from "next/server";
import { roundTitle } from "@/domain/bracket";
import { getStore } from "@/server/instance";
import { MatchCard } from "./match-card";
import { SwissTable } from "./swiss-table";

/** The public live view: bracket first, Swiss standings under it. Reads live state, so use inside <Suspense>. */
export async function BracketContent() {
  await connection();
  const { tournament } = getStore();
  const resolved = getStore().resolved();
  const { bracket, qualifiers, records, swiss } = tournament;

  if (!bracket || !resolved || !qualifiers) {
    return (
      <div className="card">
        <p className="strong">The bracket is not built yet.</p>
        <p className="note">It appears here once the Swiss ends and the top players are seeded.</p>
      </div>
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
      {swiss && (
        <section aria-labelledby="swiss">
          <h2 id="swiss">Swiss standings</h2>
          <SwissTable
            standings={swiss}
            qualifiers={qualifiers.length}
            cutRank={qualifiers[qualifiers.length - 1].swissRank}
          />
        </section>
      )}
    </>
  );
}
