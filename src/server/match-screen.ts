import "server-only";
import type { DecidedBy, ResolvedMatch } from "@/domain/knockout";
import { nextGameNote, whiteInGame, type Game, type Side } from "@/domain/match";
import { claimProblem, opponentOf, secondsLeft } from "@/domain/play";
import type { Store } from "./store";

export interface PlayView {
  match: ResolvedMatch;
  games: readonly Game[];
  isFinal: boolean;
  me: { name: string; seed: number; side: Side };
  opponent: { name: string; seed: number };
  game: {
    number: number;
    whiteName: string;
    youAreWhite: boolean;
    /** "Tied after two games, so game 3 decides." and so on. Empty for games 1 and 2. */
    note: string;
  };
  window: { closesAt: string; secondsLeft: number; over: boolean };
  ready: { me: boolean; opponent: boolean };
  /** The shared Lichess link. Only given to a player who has tapped ready. */
  link: string | null;
  /** Both players have joined the game on Lichess. */
  joined: boolean;
  claim: { by: "me" | "opponent" } | null;
  /** Why the player cannot claim a win yet, or null if they can. */
  claimBlocked: string | null;
  refereeNote: string | null;
  aborts: number;
}

export type MatchScreen =
  | { kind: "no_bracket" }
  | { kind: "not_qualified" }
  | { kind: "waiting"; title: string; name: string; seed: number }
  /** Both players are known, but the organizers have the knockout on hold. */
  | { kind: "held"; title: string; name: string; seed: number; opponent: { name: string; seed: number } }
  | { kind: "out"; title: string; winnerName: string | null; how: string }
  | { kind: "champion"; name: string }
  | ({ kind: "play" } & PlayView);

const HOW: Partial<Record<DecidedBy, string>> = {
  higher_seed: "as the higher seed",
  no_show: "after a no-show",
  organizer: "by organizer decision",
  walkover: "by walkover",
};

/** What a player should see for their place in the bracket right now. */
export function matchScreen(store: Store, username: string, now: Date): MatchScreen {
  const { bracket, qualifiers, records } = store.tournament;
  const resolved = store.resolved();
  if (!bracket || !resolved || !qualifiers) return { kind: "no_bracket" };
  const seed = store.play.seedOf(username);
  if (seed === null) return { kind: "not_qualified" };

  // The latest match this player is in, whether or not the other side is known yet.
  const latest = Object.values(resolved.matches)
    .filter((m) => (m.a.status === "player" && m.a.seed === seed) || (m.b.status === "player" && m.b.seed === seed))
    .sort((a, b) => b.round - a.round)[0];
  if (!latest) return { kind: "not_qualified" };
  const name = store.play.name(seed);

  if (latest.status === "decided") {
    if (latest.winner === seed) return { kind: "champion", name };
    const how = latest.winner === null ? "" : (HOW[latest.decidedBy ?? "score"] ?? "");
    return { kind: "out", title: latest.title, winnerName: latest.winner === null ? null : store.play.name(latest.winner), how };
  }

  const mine = store.play.openMatchOf(username);
  if (!mine) {
    const known = latest.hi !== null && latest.lo !== null;
    if (store.tournament.knockoutHeld && known && (latest.status === "ready" || latest.status === "in_progress")) {
      const other = latest.hi === seed ? latest.lo! : latest.hi!;
      return { kind: "held", title: latest.title, name, seed, opponent: { name: store.play.name(other), seed: other } };
    }
    return { kind: "waiting", title: latest.title, name, seed };
  }

  const { match, side, round } = mine;
  const other = opponentOf(side);
  const whiteSide = whiteInGame(round.game);
  const claimant = round.claim?.by;
  const joined = round.joined === true;
  const closesAt = new Date(round.closesAt);
  return {
    kind: "play",
    match,
    games: records[match.id]?.games ?? [],
    isFinal: match.id === bracket.finalId,
    me: { name, seed, side },
    opponent: { name: store.play.name(mine.opponent), seed: mine.opponent },
    game: {
      number: round.game,
      whiteName: store.play.name(whiteSide === "hi" ? match.hi : match.lo),
      youAreWhite: whiteSide === side,
      note: match.score ? nextGameNote(match.score) : "",
    },
    window: { closesAt: round.closesAt, secondsLeft: secondsLeft(now, closesAt), over: now >= closesAt },
    ready: { me: Boolean(round.ready[side]), opponent: Boolean(round.ready[other]) },
    link: round.ready[side] && round.link ? round.link.url : null,
    joined,
    claim: claimant ? { by: claimant === side ? "me" : "opponent" } : null,
    claimBlocked: round.claim
      ? "Your claim is with a referee."
      : claimProblem({
          now,
          closesAt,
          claimantReady: Boolean(round.ready[side]),
          opponentReady: Boolean(round.ready[other]),
          gameStarted: joined,
        }),
    refereeNote: round.refereeNote ?? null,
    aborts: store.tournament.play[match.id]?.aborts ?? 0,
  };
}
