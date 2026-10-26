import "server-only";
import { roundTitle } from "@/domain/bracket";
import type { DecidedBy, ResolvedMatch } from "@/domain/knockout";
import { formatCountdown, secondsLeft } from "@/domain/play";
import { points, type BoardMatch, type RoundBoard } from "@/domain/round-board";
import type { DeskItem } from "./play";
import type { Store } from "./store";

const HOW: Record<DecidedBy, string> = {
  score: "",
  higher_seed: " as the higher seed, level after every game",
  no_show: " after a no-show",
  double_no_show: " after neither player came",
  organizer: " by organizer decision",
  walkover: " on a bye",
  empty: "",
};

function scoreText(match: ResolvedMatch): string {
  return match.score && match.score.played > 0 ? `${points(match.score.hi)}–${points(match.score.lo)}` : "";
}

/** Every match of the knockout, and where it stands. Null until a bracket is built. */
export function buildRoundBoard(store: Store, now: Date): RoundBoard | null {
  const { bracket } = store.tournament;
  const resolved = store.resolved();
  if (!bracket || !resolved) return null;

  const held = store.tournament.knockoutHeld;
  const flagged = new Map<string, DeskItem>(store.play.desk(now).items.map((item) => [item.matchId, item]));
  const name = (seed: number | null) => (seed === null ? null : store.play.name(seed));

  const boardMatch = (match: ResolvedMatch): BoardMatch => {
    const base = { id: match.id, title: match.title, hi: name(match.hi), lo: name(match.lo) };
    const score = scoreText(match);

    if (match.status === "decided") {
      const winner = name(match.winner);
      const how = HOW[match.decidedBy ?? "score"];
      return { ...base, stage: "decided", note: `${winner ?? "Nobody"} advances${how}${score ? `, ${score}` : ""}.` };
    }
    if (match.status === "waiting" || match.hi === null || match.lo === null) {
      return { ...base, stage: "waiting", note: "Waiting for the earlier matches." };
    }
    if (held) return { ...base, stage: "held", note: "On hold until the knockout is started." };

    const item = flagged.get(match.id);
    if (item) return { ...base, stage: "flagged", note: item.reasons.join(" ") };

    const round = store.tournament.play[match.id]?.round;
    if (round?.joined) {
      return { ...base, stage: "playing", note: `Game ${round.game} is being played.${score ? ` Score ${score}.` : ""}` };
    }
    if (!round) return { ...base, stage: "ready", note: "Waiting for the players." };

    const hiReady = Boolean(round.ready.hi);
    const loReady = Boolean(round.ready.lo);
    const who =
      hiReady && loReady
        ? "Both are ready"
        : hiReady
          ? `${base.hi} is ready, ${base.lo} is not yet`
          : loReady
            ? `${base.lo} is ready, ${base.hi} is not yet`
            : "Neither is ready yet";
    const left = formatCountdown(secondsLeft(now, new Date(round.closesAt)));
    return { ...base, stage: "ready", note: `Game ${round.game}: ${who}. ${left} of waiting time left.${score ? ` Score ${score}.` : ""}` };
  };

  return {
    held,
    champion: name(resolved.champion),
    rounds: bracket.rounds.map((matches, i) => ({
      round: i + 1,
      title: roundTitle(bracket.size, i + 1),
      matches: matches
        .map((m) => resolved.matches[m.id])
        .filter((m) => m.decidedBy !== "empty") // two empty slots: not a match at all
        .map(boardMatch),
    })),
  };
}
