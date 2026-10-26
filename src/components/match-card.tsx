import type { DecidedBy, ResolvedMatch } from "@/domain/knockout";
import { nextGameNote, type Game } from "@/domain/match";
import type { Qualifier } from "@/server/store";

type Names = readonly Qualifier[];

const nameOf = (names: Names, seed: number | null) =>
  seed === null ? "To be decided" : (names[seed - 1]?.username ?? `Seed ${seed}`);

function advancesNote(by: DecidedBy | null, isFinal: boolean): string {
  switch (by) {
    case "higher_seed":
      return "as the higher seed";
    case "no_show":
      return "after a no-show";
    case "double_no_show":
      return isFinal ? "as the higher seed, as neither player showed" : "";
    case "organizer":
      return "by organizer decision";
    case "walkover":
      return "by walkover";
    default:
      return "";
  }
}

function Row({
  seed,
  names,
  score,
  won,
  empty = false,
}: {
  seed: number | null;
  names: Names;
  score: number | null;
  won: boolean;
  /** Nobody is coming to this slot, as opposed to the slot not being decided yet. */
  empty?: boolean;
}) {
  return (
    <div className={`pl${won ? " w" : ""}`}>
      <span className="sd">{seed ?? ""}</span>
      <span className="nm">{empty ? "No opponent" : nameOf(names, seed)}</span>
      <span className="sc">{score ?? ""}</span>
    </div>
  );
}

function gameLine(game: Game, i: number, match: ResolvedMatch, names: Names): string {
  const result =
    game.outcome === "draw" ? "Draw" : `${nameOf(names, game.outcome === "hi" ? match.hi : match.lo)} won`;
  return `Game ${i + 1}: ${result} (${game.source === "organizer" ? "set by organizer" : "read from Lichess"})`;
}

/**
 * One knockout match for the public view. Organizer reasons and names are
 * deliberately not shown here; overrides only say "set by organizer".
 */
export function MatchCard({
  match,
  names,
  games,
  isFinal,
}: {
  match: ResolvedMatch;
  names: Names;
  games: readonly Game[];
  isFinal: boolean;
}) {
  const { hi, lo, score, winner } = match;
  const decidedWithoutWinner = match.status === "decided" && winner === null;
  // A winner who got through some way other than the games is worth saying, even where the notes are left out.
  const advancedBecause = winner !== null ? advancesNote(match.decidedBy, isFinal) : "";

  return (
    <section className="card" data-status={match.status}>
      {(match.status === "ready" || match.status === "in_progress") && (
        <span className="tag">{match.status === "ready" ? "Ready to play" : "In progress"}</span>
      )}
      <h3>{match.title}</h3>
      {hi !== null && lo !== null ? (
        <>
          <Row seed={hi} names={names} score={score && score.played > 0 ? score.hi : null} won={winner === hi} />
          <Row seed={lo} names={names} score={score && score.played > 0 ? score.lo : null} won={winner === lo} />
        </>
      ) : (
        <>
          <Row
            seed={match.a.status === "player" ? match.a.seed : null}
            names={names}
            score={null}
            won={false}
            empty={match.a.status === "empty"}
          />
          <Row
            seed={match.b.status === "player" ? match.b.seed : null}
            names={names}
            score={null}
            won={false}
            empty={match.b.status === "empty"}
          />
        </>
      )}
      {games.length > 0 && (
        <ul className="log">
          {games.map((game, i) => (
            <li key={i}>{gameLine(game, i, match, names)}</li>
          ))}
        </ul>
      )}
      {match.status === "waiting" && <p className="note tight">Waiting for the earlier matches.</p>}
      {(match.status === "ready" || match.status === "in_progress") && score?.next && (
        <p className="note tight">
          Game {score.next.game} next. {nextGameNote(score)}
        </p>
      )}
      {match.status === "ready" && !score?.next && <p className="note tight">Game 1 next.</p>}
      {winner !== null && (
        <p className={advancedBecause ? "adv why" : "adv"}>
          {[nameOf(names, winner), "advances", advancedBecause].filter(Boolean).join(" ")}.
        </p>
      )}
      {decidedWithoutWinner && match.decidedBy === "double_no_show" && (
        <p className="note tight why">Neither player showed. Both are out.</p>
      )}
      {decidedWithoutWinner && match.decidedBy === "empty" && (
        <p className="note tight why">No players reach this match.</p>
      )}
    </section>
  );
}
