import { connection } from "next/server";
import { roundTitle } from "@/domain/bracket";
import { readStore } from "@/server/instance";
import { getLichess } from "@/server/lichess";
import { swissStandings } from "@/server/swiss";
import { getSwissFeed } from "@/server/swiss-feed";
import { AutoRefresh } from "./auto-refresh";
import { FullScreenButton } from "./full-screen-button";
import { MatchCard } from "./match-card";
import { SwissTable } from "./swiss-table";

/** How often the public view brings itself up to date, for a phone left open or a projector. */
const REFRESH_MS = 30_000;

/** Up to this many rounds the Swiss sits beside the bracket on a wide screen. A bigger bracket needs the width. */
const MOST_ROUNDS_BESIDE = 4;

/**
 * The public live view: the Swiss while it is being played, then the bracket with the Swiss under it. On a wide
 * screen, such as a projector, the rounds run across the page and the Swiss sits beside them (see `.live` in the
 * stylesheet). Reads live state, so use inside <Suspense>, within a `.live` element.
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
  /** Under the page on a phone and above it on a wide screen. Once there is a champion nothing changes any more. */
  const status = (refreshing: boolean) => (
    <div className="live-full live-status">
      {refreshing && <p className="note tight">This page updates by itself every {REFRESH_MS / 1000} seconds.</p>}
      <FullScreenButton />
      {refreshing && <AutoRefresh everyMs={REFRESH_MS} />}
    </div>
  );

  if (!bracket || !resolved || !qualifiers) {
    return (
      <>
        <div className="live-full">
          {swiss.kind !== "none" && table}
          <div className="card">
            <p className="strong">The bracket is not built yet.</p>
            <p className="note">It appears here once the Swiss ends and the top players are seeded.</p>
          </div>
        </div>
        {status(true)}
      </>
    );
  }

  const champion = resolved.champion;
  const hasSwiss = swiss.kind !== "none";
  const beside = hasSwiss && bracket.rounds.length <= MOST_ROUNDS_BESIDE;
  return (
    <>
      <div className={beside ? "live-main" : "live-main alone"}>
        {champion !== null && (
          <div className="champ">Champion: {qualifiers[champion - 1]?.username} (provisional)</div>
        )}
        <div className="rounds">
          {bracket.rounds.map((round, i) => (
            <section key={i} className="round" aria-labelledby={`round-${i + 1}`}>
              <h2 id={`round-${i + 1}`}>{roundTitle(bracket.size, i + 1)}</h2>
              <div className="slots">
                {round.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={resolved.matches[m.id]}
                    names={qualifiers}
                    games={resolved.matches[m.id].stale ? [] : (records[m.id]?.games ?? [])}
                    isFinal={m.id === bracket.finalId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      {hasSwiss && <div className={beside ? "live-side" : "live-full"}>{table}</div>}
      {status(champion === null)}
    </>
  );
}
