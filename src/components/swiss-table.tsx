import { cutNotes, type CutRow, type CutView } from "@/domain/cutoff";
import { eastTime } from "@/domain/schedule";
import type { SwissStandings } from "@/server/swiss";

/** Once the Swiss is over the line says who is through and who is out, so only the tiebreak needs a label. */
function fateLabel(row: CutRow, finished: boolean): string | null {
  switch (row.fate) {
    case "through":
      return finished ? null : "Through";
    case "out":
      return finished ? null : "Out";
    case "bubble":
      return finished ? "Tiebreak" : "Bubble";
    case "open":
      return null;
  }
}

function Standings({ view }: { view: CutView }) {
  const lastInside = view.rows.findLastIndex((row) => row.inside);
  const showLine = view.cutPoints !== null;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Points</th>
            <th>Cut-off</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.flatMap((row, i) => {
            const label = fateLabel(row, view.finished);
            const cells = (
              <tr key={row.username} className={row.fate}>
                <td>{row.rank}</td>
                <td>{row.username}</td>
                <td>{row.points}</td>
                <td className="fate">{label}</td>
              </tr>
            );
            return showLine && i === lastInside
              ? [
                  cells,
                  <tr key="line" className="cutline">
                    <td colSpan={4}>The line: the top {view.places} play on</td>
                  </tr>,
                ]
              : [cells];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Swiss standings as Lichess reports them, with the cut-off line and who is on the bubble. Ranks are shown as
 * given and never worked out here. Says why when there is nothing to show.
 */
export function SwissTable({ swiss }: { swiss: SwissStandings }) {
  switch (swiss.kind) {
    case "none":
      return null;
    case "choose":
      return (
        <div className="card">
          <p className="strong">The Swiss standings are not here yet.</p>
          <p className="note">They appear once the organizers choose the Swiss on Lichess.</p>
        </div>
      );
    case "unavailable":
      return (
        <div className="card">
          <p className="strong">The Swiss standings could not be read.</p>
          <p className="note">{swiss.error}</p>
        </div>
      );
    case "table": {
      const { view, name, progress, started, readAt, late } = swiss;
      return (
        <div className="card">
          <p className="strong">{name ? `${name}: ${progress}` : progress}</p>
          {view.rows.length === 0 ? (
            <p className="note">
              {started
                ? "No player in the tournament has joined this Swiss yet."
                : "The standings appear once the first round starts."}
            </p>
          ) : (
            <>
              <Standings view={view} />
              {cutNotes(view).map((line) => (
                <p key={line} className="note tight">
                  {line}
                </p>
              ))}
            </>
          )}
          {readAt && (
            <p className="note tight">
              {late
                ? `Lichess is not answering just now, so these are the standings from ${eastTime(readAt)}.`
                : `Read from Lichess at ${eastTime(readAt)}. The ranks are Lichess’s own.`}
            </p>
          )}
          {!readAt && <p className="note tight">Read from Lichess when the bracket was built. The ranks are Lichess’s own.</p>}
        </div>
      );
    }
  }
}
