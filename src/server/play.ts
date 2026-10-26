import "server-only";
import { withGame, type ResolvedMatch } from "@/domain/knockout";
import { whiteInGame, type Side } from "@/domain/match";
import {
  GAME_CLOCK,
  GAME_RULES,
  LINK_LIFETIME,
  NEXT_GAME_WINDOW,
  REPEATED_ABORTS,
  claimProblem,
  classifyGame,
  isLate,
  opponentOf,
  outcomeOf,
  windowFor,
  type GameRound,
  type MatchPlay,
  type ProblemReport,
} from "@/domain/play";
import { sameUser, type Result } from "@/domain/registration";
import { ask } from "./lichess/ask";
import type { GameLink, LichessClient } from "./lichess/types";
import type { Store } from "./store";

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error }) as const;
const NO_MATCH = "You don’t have a match to play right now.";

/**
 * Links being made on Lichess, by match and game. Shared by every request in this process, so two players who
 * tap at the same moment still get one link, even though each request works on its own copy of the state.
 */
const linksInFlight = new Map<string, Promise<GameLink>>();

/** A player's open match: the one they can play right now. */
export interface MyMatch {
  match: ResolvedMatch;
  side: Side;
  seed: number;
  opponent: number;
  round: GameRound;
}

export interface DeskItem {
  matchId: string;
  title: string;
  game: number;
  hi: { name: string; ready: boolean };
  lo: { name: string; ready: boolean };
  closesAt: string;
  windowOver: boolean;
  joined: boolean;
  claim: { by: Side; byName: string; at: string } | null;
  aborts: number;
  refereeNote: string | null;
  /** Why this match is on the desk. */
  reasons: string[];
}

export interface DeskProblem extends ProblemReport {
  matchId: string;
  title: string;
}

/**
 * What happens to a match while it is being played: the waiting windows, who is ready, the Lichess link,
 * reading the result back, no-show claims and problem reports. The store owns one of these and calls `sync`
 * whenever a result changes, so a match that has just become ready always has its waiting time running.
 *
 * Findings from the live Lichess checks (docs/lichess-checks.md) that shape this:
 *  - Lichess does not end a game because someone never turns up, so the waiting time is the app's own;
 *  - an aborted game, which includes an early resignation, has no result and counts as not played;
 *  - a player who never joins leaves no game at all, only a challenge, which the app can cancel.
 */
export class MatchPlayService {
  private pendingCancels: string[] = [];
  private madeLinks: string[] = [];

  constructor(private readonly store: Store) {}

  private get state(): Record<string, MatchPlay> {
    return this.store.tournament.play;
  }

  name(seed: number | null): string {
    return seed === null ? "?" : (this.store.tournament.qualifiers?.[seed - 1]?.username ?? `Seed ${seed}`);
  }

  seedOf(username: string): number | null {
    const index = this.store.tournament.qualifiers?.findIndex((q) => sameUser(q.username, username)) ?? -1;
    return index === -1 ? null : index + 1;
  }

  openMatchOf(username: string): MyMatch | null {
    const seed = this.seedOf(username);
    const resolved = this.store.resolved();
    if (seed === null || !resolved) return null;
    for (const match of Object.values(resolved.matches)) {
      if (match.hi !== seed && match.lo !== seed) continue;
      if (match.status !== "ready" && match.status !== "in_progress") continue;
      const round = this.state[match.id]?.round;
      if (!round || match.hi === null || match.lo === null) continue;
      const side: Side = match.hi === seed ? "hi" : "lo";
      return { match, side, seed, opponent: side === "hi" ? match.lo : match.hi, round };
    }
    return null;
  }

  /** The matches with a game link out, which is where a result can turn up without anyone looking. */
  watching(): string[] {
    return Object.entries(this.state)
      .filter(([, play]) => play.round?.link)
      .map(([matchId]) => matchId);
  }

  /** Links nobody should use any more. The caller closes them on Lichess, then they are forgotten. */
  takeCancels(): string[] {
    const taken = this.pendingCancels;
    this.pendingCancels = [];
    return taken;
  }

  /**
   * Links made on Lichess since the last call. Whoever saves the store checks which of them ended up in the
   * saved state, and closes the rest: a save that lost a race to another server leaves its link unused.
   */
  takeMadeLinks(): string[] {
    const taken = this.madeLinks;
    this.madeLinks = [];
    return taken;
  }

  private dropLink(round: GameRound) {
    if (round.link) this.pendingCancels.push(round.link.id);
    round.link = undefined;
  }

  /** Forgets every match in play, for when the bracket is reset. */
  reset() {
    for (const play of Object.values(this.state)) if (play.round) this.dropLink(play.round);
    this.store.tournament.play = {};
  }

  /**
   * Makes sure every open match has a waiting time running for the game it is on, and closes the book on
   * matches that are decided. Safe to call as often as you like. `ended` says that a game of one match has
   * just finished at that time, which is when its next waiting time starts.
   */
  sync(now: Date, ended?: { matchId: string; at: Date }) {
    const resolved = this.store.resolved();
    // A bracket on hold has no waiting times running, so nobody can lose a match to a clock that has not started.
    if (!resolved || this.store.tournament.knockoutHeld) return;
    for (const match of Object.values(resolved.matches)) {
      const open = match.status === "ready" || match.status === "in_progress";
      if (!open) {
        const round = this.state[match.id]?.round;
        if (round) this.dropLink(round);
        if (this.state[match.id]) this.state[match.id].round = null;
        continue;
      }
      const game = match.score?.next?.game ?? 1;
      const play = (this.state[match.id] ??= { round: null, aborts: 0, problems: [] });
      if (play.round?.game === game) continue;
      if (play.round) this.dropLink(play.round);
      const from = ended?.matchId === match.id && ended.at < now ? ended.at : now;
      play.round = {
        game,
        startedAt: from.toISOString(),
        closesAt: new Date(from.getTime() + windowFor(game)).toISOString(),
        ready: {},
      };
    }
  }

  // Players

  markReady(username: string, now: Date): Result<object> {
    const mine = this.openMatchOf(username);
    if (!mine) return fail(NO_MATCH);
    mine.round.ready[mine.side] ??= now.toISOString();
    return ok;
  }

  /** The link the two players use for the current game. Created on first request, then shared. */
  async ensureLink(username: string, lichess: LichessClient, now: Date): Promise<Result<{ url: string }>> {
    const mine = this.openMatchOf(username);
    if (!mine) return fail(NO_MATCH);
    const { match, round } = mine;
    if (!round.ready[mine.side]) return fail("Tap I’m ready first.");
    if (round.claim) return fail("A referee is deciding this match, so the game cannot be started.");

    if (round.link) {
      const link = round.link;
      const usable = await ask(async () => (await lichess.getGame(link.id)) !== null || (await lichess.isLinkOpen(link.id)));
      if (!usable.ok) return usable;
      if (usable.value) return { ok: true, url: link.url };
      // Expired or cancelled, and nobody started a game on it: a fresh one is made below.
      if (round.link?.id === link.id) round.link = undefined;
    }

    const key = `${match.id}:${round.game}`;
    let pending = linksInFlight.get(key);
    if (!pending) {
      const white = whiteInGame(round.game) === "hi" ? match.hi : match.lo;
      const black = whiteInGame(round.game) === "hi" ? match.lo : match.hi;
      pending = lichess.createGameLink({
        users: [this.name(white), this.name(black)],
        clock: GAME_CLOCK,
        rules: GAME_RULES,
        expiresAt: new Date(now.getTime() + LINK_LIFETIME),
        name: `Castle Connect: ${match.title}, game ${round.game}`,
      });
      linksInFlight.set(key, pending);
      const forget = () => void linksInFlight.delete(key);
      pending.then(forget, forget);
    }
    const shared = pending;
    const created = await ask(() => shared);
    if (!created.ok) return created;
    // Whatever happens below, the link exists on Lichess: if the state does not keep it, it is closed afterwards.
    this.madeLinks.push(created.value.id);

    const current = this.state[match.id]?.round;
    if (!current || current.game !== round.game) return fail("The match has moved on. Reload the page.");
    current.link ??= { id: created.value.id, url: created.value.url, createdAt: now.toISOString() };
    return { ok: true, url: current.link.url };
  }

  /**
   * Reads the game from Lichess and acts on it: a finished game becomes a result, an aborted one counts as not
   * played, one that needs a human goes to a referee. Returns whether anything changed.
   */
  async syncGame(matchId: string, lichess: LichessClient, now: Date): Promise<Result<{ changed: boolean }>> {
    const round = this.state[matchId]?.round;
    const link = round?.link;
    if (!round || !link) return { ok: true, changed: false };

    const read = await ask(() => lichess.getGame(link.id));
    if (!read.ok) return read;
    const game = read.value;
    if (!game) return { ok: true, changed: false };

    // Someone may have changed the match while Lichess was answering.
    const current = this.state[matchId]?.round;
    if (!current || current.game !== round.game || current.link?.id !== link.id) return { ok: true, changed: false };

    const verdict = classifyGame(game.status, game.winner);
    const label = this.store.label(matchId);

    if (verdict.kind === "ongoing") {
      const changed = !current.joined;
      current.joined = true;
      return { ok: true, changed };
    }

    if (verdict.kind === "not_played") {
      const play = this.state[matchId];
      play.aborts += 1;
      // The same game is played again on a fresh link, and both players tap ready again.
      current.link = undefined;
      current.joined = false;
      current.claim = undefined;
      current.ready = {};
      current.startedAt = now.toISOString();
      current.closesAt = new Date(now.getTime() + NEXT_GAME_WINDOW).toISOString();
      this.store.log("Lichess", now, `${label}: game ${round.game} was aborted on Lichess and counts as not played.`);
      return { ok: true, changed: true };
    }

    if (verdict.kind === "needs_referee") {
      if (current.refereeNote === verdict.reason) return { ok: true, changed: false };
      current.refereeNote = verdict.reason;
      current.joined = true;
      this.store.log("Lichess", now, `${label}: game ${round.game} needs a referee. ${verdict.reason}`);
      return { ok: true, changed: true };
    }

    const match = this.store.resolved()?.matches[matchId];
    if (!match) return { ok: true, changed: false };
    const endedAt = game.endedAt && game.endedAt < now ? game.endedAt : now;
    const outcome = outcomeOf(round.game, verdict.winner);
    try {
      this.store.tournament.records[matchId] = withGame(match, this.store.tournament.records[matchId], {
        outcome,
        source: "lichess",
        lichessId: game.id,
        endedAt: endedAt.toISOString(),
      });
    } catch {
      return { ok: true, changed: false };
    }
    current.link = undefined; // the game is over, so there is nothing left to close
    const said = outcome === "draw" ? "a draw" : `${this.name(outcome === "hi" ? match.hi : match.lo)} won`;
    this.store.log("Lichess", now, `${label}: read the result of game ${round.game} from Lichess (${said}).`);
    this.sync(now, { matchId, at: endedAt });
    return { ok: true, changed: true };
  }

  /** A waiting player's request to be given the win because the opponent never appeared. A referee decides. */
  async claimWin(username: string, lichess: LichessClient, now: Date): Promise<Result<object>> {
    const mine = this.openMatchOf(username);
    if (!mine) return fail(NO_MATCH);
    const { round, side, match } = mine;
    if (round.claim) return ok;

    let started = round.joined === true;
    if (round.link && !started) {
      const link = round.link;
      const read = await ask(() => lichess.getGame(link.id));
      if (!read.ok) return read;
      started = read.value !== null;
    }
    const problem = claimProblem({
      now,
      closesAt: new Date(round.closesAt),
      claimantReady: Boolean(round.ready[side]),
      opponentReady: Boolean(round.ready[opponentOf(side)]),
      gameStarted: started,
    });
    if (problem) return fail(problem);

    const current = this.state[match.id]?.round;
    if (!current || current.game !== round.game) return fail("The match has moved on. Reload the page.");
    current.claim = { by: side, at: now.toISOString() };
    const other = side === "hi" ? match.lo : match.hi;
    this.store.log(username, now, `Claimed a win in ${this.store.label(match.id)}: ${this.name(other)} did not appear.`);
    return ok;
  }

  reportProblem(username: string, text: string, now: Date): Result<object> {
    const seed = this.seedOf(username);
    const resolved = this.store.resolved();
    if (seed === null || !resolved) return fail(NO_MATCH);
    const involved = Object.values(resolved.matches)
      .filter((m) => (m.hi === seed || m.lo === seed) && m.status !== "waiting")
      .sort((a, b) => b.round - a.round)[0];
    if (!involved) return fail(NO_MATCH);

    const body = text.trim();
    if (!body) return fail("Say what went wrong.");
    if (body.length > 500) return fail("Keep it under 500 characters.");
    const play = (this.state[involved.id] ??= { round: null, aborts: 0, problems: [] });
    if (play.problems.filter((p) => sameUser(p.by, username)).length >= 5) {
      return fail("You have reported this match several times already. A referee will contact you.");
    }
    const games = this.store.tournament.records[involved.id]?.games ?? [];
    const lastEnded = [...games].reverse().find((g) => g.endedAt)?.endedAt;
    play.problems.push({
      by: username,
      at: now.toISOString(),
      game: play.round?.game ?? (games.length > 0 ? games.length : null),
      text: body,
      late: isLate(lastEnded ? new Date(lastEnded) : null, now),
    });
    this.store.log(username, now, `Reported a problem in ${this.store.label(involved.id)}.`, body);
    return ok;
  }

  // Referees

  /** Gives the win to the player who claimed it. */
  confirmClaim(actor: string, matchId: string, now: Date): Result<object> {
    if (!this.store.can(actor, "forfeit")) return fail("You don’t have access to that.");
    const claim = this.state[matchId]?.round?.claim;
    const match = this.store.resolved()?.matches[matchId];
    if (!claim || !match) return fail("There is no claim to review.");
    const claimant = this.name(claim.by === "hi" ? match.hi : match.lo);
    const absent = this.name(claim.by === "hi" ? match.lo : match.hi);
    return this.store.recordNoShow(
      actor,
      matchId,
      { hi: claim.by === "hi", lo: claim.by === "lo" },
      `${claimant} claimed the win and ${absent} did not appear within the waiting time.`,
      now,
    );
  }

  /** Turns a claim down and gives the players another 2 minutes. */
  rejectClaim(actor: string, matchId: string, now: Date): Result<object> {
    if (!this.store.can(actor, "forfeit")) return fail("You don’t have access to that.");
    const round = this.state[matchId]?.round;
    if (!round?.claim) return fail("There is no claim to review.");
    round.claim = undefined;
    round.closesAt = new Date(now.getTime() + NEXT_GAME_WINDOW).toISOString();
    this.store.log(actor, now, `Turned down a no-show claim in ${this.store.label(matchId)}. The players have 2 more minutes.`);
    return ok;
  }

  /** Records a no-show when nobody claimed: "hi" or "lo" is the one who turned up, "none" is neither. */
  settleNoShow(actor: string, matchId: string, present: "hi" | "lo" | "none", now: Date): Result<object> {
    const match = this.store.resolved()?.matches[matchId];
    if (!match) return fail("That match does not exist.");
    const reason =
      present === "none"
        ? "Neither player appeared within the waiting time."
        : `${this.name(present === "hi" ? match.hi : match.lo)} was ready and ${this.name(present === "hi" ? match.lo : match.hi)} did not appear within the waiting time.`;
    return this.store.recordNoShow(actor, matchId, { hi: present === "hi", lo: present === "lo" }, reason, now);
  }

  /** What needs a referee's eyes: claims, matches past their waiting time, odd Lichess results, repeated aborts. */
  desk(now: Date): { items: DeskItem[]; problems: DeskProblem[] } {
    const resolved = this.store.resolved();
    const items: DeskItem[] = [];
    const problems: DeskProblem[] = [];
    if (!resolved) return { items, problems };

    for (const match of Object.values(resolved.matches)) {
      const play = this.state[match.id];
      for (const problem of play?.problems ?? []) problems.push({ ...problem, matchId: match.id, title: match.title });
      const round = play?.round;
      if (!play || !round || match.hi === null || match.lo === null) continue;

      const windowOver = now >= new Date(round.closesAt);
      const joined = round.joined === true;
      const reasons: string[] = [];
      if (round.claim) reasons.push("A player claimed the win.");
      else if (windowOver && !joined) reasons.push("The waiting time is over and the game has not started.");
      if (round.refereeNote) reasons.push(round.refereeNote);
      if (play.aborts >= REPEATED_ABORTS) reasons.push(`Lichess aborted ${play.aborts} games of this match.`);
      if (reasons.length === 0) continue;

      items.push({
        matchId: match.id,
        title: match.title,
        game: round.game,
        hi: { name: this.name(match.hi), ready: Boolean(round.ready.hi) },
        lo: { name: this.name(match.lo), ready: Boolean(round.ready.lo) },
        closesAt: round.closesAt,
        windowOver,
        joined,
        claim: round.claim
          ? { by: round.claim.by, byName: this.name(round.claim.by === "hi" ? match.hi : match.lo), at: round.claim.at }
          : null,
        aborts: play.aborts,
        refereeNote: round.refereeNote ?? null,
        reasons,
      });
    }
    problems.sort((a, b) => b.at.localeCompare(a.at));
    return { items, problems };
  }
}
