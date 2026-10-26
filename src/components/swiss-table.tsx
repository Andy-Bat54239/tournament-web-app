import type { StandingRow } from "@/server/lichess/types";

/**
 * Swiss standings as Lichess reports them, with the cut-off line under the last
 * qualifier. Ranks are shown as given, never recomputed.
 */
export function SwissTable({
  standings,
  qualifiers,
  cutRank,
}: {
  standings: readonly StandingRow[];
  /** How many players advance. */
  qualifiers: number;
  /** Lichess rank of the last player to advance. */
  cutRank: number | null;
}) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.username} className={row.rank === cutRank ? "cut" : undefined}>
              <td>{row.rank}</td>
              <td>{row.username}</td>
              <td>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note tight">Read from Lichess. The line marks the cut-off: the top {qualifiers} play on.</p>
    </div>
  );
}
