import "server-only";
import { buildBracket, type Bracket } from "@/domain/bracket";
import { planFormat, seedByRating } from "@/domain/format";
import {
  noShowOverride,
  resolveBracket,
  withGame,
  withOverride,
  withUndo,
  organizerGame,
  type MatchRecord,
  type ResolvedBracket,
} from "@/domain/knockout";
import type { GameOutcome } from "@/domain/match";
import type { MatchPlay } from "@/domain/play";
import { can, type AdminAccess, type Permission, type Preset } from "@/domain/permissions";
import { normalizeUgandaPhone } from "@/domain/phone";
import {
  checkIn,
  field,
  findRegistration,
  joinTeam,
  register,
  removeNoShows,
  sameUser,
  withdraw,
  type Registration,
  type Result,
} from "@/domain/registration";
import {
  announcementText,
  canWithdraw,
  deriveSchedule,
  eastDate,
  eastTime,
  formatWhen,
  parseEast,
  phaseAt,
  type Schedule,
} from "@/domain/schedule";
import type { LichessProfile, StandingRow } from "./lichess/types";
import { MatchPlayService } from "./play";

export interface Qualifier {
  seed: number;
  username: string;
  rating: number | null;
  /** Rank in the Swiss, or null in a straight knockout. */
  swissRank: number | null;
  points: number | null;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  reason?: string;
}

export interface AdminRecord {
  username: string;
  preset: Preset | null;
  grants: Permission[];
}

export interface ScheduleChange {
  from: string;
  to: string;
  at: string;
  by: string;
  reason: string;
}

export interface TournamentState {
  name: string;
  /** ISO instant. */
  startsAt: string;
  cap: number;
  status: "open" | "ended";
  scheduleChange: ScheduleChange | null;
  announcement: { text: string; sentAt: string | null } | null;
  swiss: StandingRow[] | null;
  qualifiers: Qualifier[] | null;
  bracket: Bracket | null;
  records: Record<string, MatchRecord>;
  /** The game each open match is on, who is ready, links, claims and problems. Keyed by match id. */
  play: Record<string, MatchPlay>;
}

export interface StoreConfig {
  tournament: TournamentState;
  registrations?: Registration[];
  admins?: AdminRecord[];
  /** Lichess username of the super admin (Joel). */
  superAdmin: string | null;
}

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error }) as const;
const FORBIDDEN = "You don’t have access to that.";

/**
 * All tournament state, and every change to it. Each organizer action checks
 * the actor's permission here, so the rule lives in one place and cannot be
 * skipped by a forgotten check in a page or form.
 *
 * This is an in-memory store: state is lost when the server restarts. It is a
 * stand-in for Postgres, kept behind this class so the swap stays local.
 */
export class Store {
  tournament: TournamentState;
  registrations: Registration[];
  admins: AdminRecord[];
  audit: AuditEntry[] = [];
  /** Playing the matches: waiting windows, links, reading results, claims and problem reports. */
  readonly play: MatchPlayService;
  private readonly superAdmin: string | null;

  constructor(config: StoreConfig) {
    this.play = new MatchPlayService(this);
    this.tournament = config.tournament;
    this.registrations = config.registrations ?? [];
    this.admins = config.admins ?? [];
    this.superAdmin = config.superAdmin;
  }

  // Reading

  schedule(): Schedule {
    return deriveSchedule(new Date(this.tournament.startsAt));
  }

  resolved(): ResolvedBracket | null {
    const { bracket, records } = this.tournament;
    return bracket ? resolveBracket(bracket, records) : null;
  }

  access(username: string | null): AdminAccess | null {
    if (!username) return null;
    if (this.superAdmin && sameUser(username, this.superAdmin)) {
      return { username, superAdmin: true, grants: [] };
    }
    const admin = this.admins.find((a) => sameUser(a.username, username));
    return admin ? { username: admin.username, superAdmin: false, grants: admin.grants } : null;
  }

  can(username: string | null, permission: Permission): boolean {
    return can(this.access(username), permission, this.tournament.status === "ended");
  }

  registration(username: string): Registration | undefined {
    return findRegistration(this.registrations, username);
  }

  // Players

  signUp(
    profile: LichessProfile,
    whatsappInput: string,
    acceptedRules: boolean,
    now: Date,
  ): Result<{ status: "registered" | "waitlisted"; position: number }> {
    if (phaseAt(this.schedule(), now) !== "signup_open") return fail("Sign-ups are closed.");
    const whatsapp = normalizeUgandaPhone(whatsappInput);
    if (!whatsapp) return fail("Use the format +256 7XX XXX XXX.");
    if (!acceptedRules) return fail("Tick the box to accept the rules.");

    const result = register(
      this.registrations,
      { username: profile.username, rating: profile.blitzRating, whatsapp },
      this.tournament.cap,
      now,
    );
    if (!result.ok) return result;
    this.registrations = result.regs;
    return { ok: true, status: result.status, position: result.position };
  }

  withdraw(username: string, now: Date): Result<object> {
    const allowed = canWithdraw(this.schedule(), now, {
      bracketBuilt: this.tournament.bracket !== null,
      scheduleChanged: this.tournament.scheduleChange !== null,
    });
    if (!allowed) return fail("The withdrawal deadline has passed. Please ask an organizer.");
    const result = withdraw(this.registrations, username, this.tournament.cap);
    if (!result.ok) return result;
    this.registrations = result.regs;
    return ok;
  }

  checkIn(username: string, now: Date): Result<object> {
    const phase = phaseAt(this.schedule(), now);
    if (phase !== "check_in_open") {
      return fail(
        phase === "signup_open" || phase === "signup_closed"
          ? `Check-in opens at ${eastTime(this.schedule().checkInOpensAt)}.`
          : "Check-in is closed.",
      );
    }
    const result = checkIn(this.registrations, username);
    if (!result.ok) return result;
    this.registrations = result.regs;
    return ok;
  }

  joinTeam(username: string): Result<object> {
    const result = joinTeam(this.registrations, username);
    if (!result.ok) return result;
    this.registrations = result.regs;
    return ok;
  }

  // Organizers

  private deny(actor: string, permission: Permission) {
    return this.can(actor, permission) ? null : fail(FORBIDDEN);
  }

  /** Writes to the audit log. Automatic actions use "Lichess" as the actor. */
  log(actor: string, now: Date, action: string, reason?: string) {
    this.audit.push({ at: now.toISOString(), actor, action, ...(reason ? { reason } : {}) });
  }

  removeNoShows(actor: string, now: Date): Result<{ removed: string[]; promoted: string[] }> {
    const denied = this.deny(actor, "roster");
    if (denied) return denied;
    const result = removeNoShows(this.registrations, this.tournament.cap);
    this.registrations = result.regs;
    this.log(
      actor,
      now,
      `Removed ${result.removed.length} no-show(s) and promoted ${result.promoted.length} from the waitlist.`,
    );
    return { ok: true, removed: result.removed, promoted: result.promoted };
  }

  changeSchedule(
    actor: string,
    input: { date: string; time: string; reason: string },
    now: Date,
  ): Result<object> {
    const denied = this.deny(actor, "settings");
    if (denied) return denied;
    const next = parseEast(input.date, input.time);
    if (!next) return fail("Enter both a date and a time.");

    const current = new Date(this.tournament.startsAt);
    if (next.getTime() === current.getTime()) return fail("That is already the start time.");
    const reason = input.reason.trim();
    if (!reason) return fail("Add a reason for the change.");

    this.tournament.startsAt = next.toISOString();
    this.tournament.scheduleChange = {
      from: current.toISOString(),
      to: next.toISOString(),
      at: now.toISOString(),
      by: actor,
      reason,
    };
    this.tournament.announcement = {
      text: announcementText(this.schedule(), true),
      sentAt: null,
    };
    this.log(actor, now, `Schedule changed from ${formatWhen(current)} to ${formatWhen(next)}.`, reason);
    return ok;
  }

  markAnnouncementSent(actor: string, now: Date): Result<object> {
    const denied = this.deny(actor, "announce");
    if (denied) return denied;
    const announcement = this.tournament.announcement;
    if (!announcement) return fail("There is no announcement to send.");
    announcement.sentAt = now.toISOString();
    this.log(actor, now, "Confirmed the schedule announcement was sent to the community chat.");
    return ok;
  }

  buildBracket(
    actor: string,
    standings: StandingRow[] | null,
    opts: { qualifiers?: number },
    now: Date,
  ): Result<{ qualifiers: number }> {
    const denied = this.deny(actor, "rounds");
    if (denied) return denied;
    if (this.tournament.bracket) return fail("The bracket is already built.");

    const players = field(this.registrations);
    const plan = planFormat(players.length);
    if (!plan) return fail("At least 2 players are needed to build a bracket.");

    let ranked: Qualifier[];
    if (plan.kind === "knockout_only") {
      ranked = seedByRating(players).map((p, i) => ({
        seed: i + 1,
        username: p.username,
        rating: p.rating,
        swissRank: null,
        points: null,
      }));
    } else {
      if (!standings?.length) return fail("The Swiss standings are not available yet.");
      const ratings = new Map(players.map((p) => [p.username.toLowerCase(), p.rating]));
      ranked = standings
        .filter((s) => ratings.has(s.username.toLowerCase()))
        .sort((a, b) => a.rank - b.rank)
        .map((s, i) => ({
          seed: i + 1,
          username: s.username,
          rating: ratings.get(s.username.toLowerCase()) ?? null,
          swissRank: s.rank,
          points: s.points,
        }));
    }

    const most = Math.min(ranked.length, 32);
    const count = opts.qualifiers ?? plan.qualifiers;
    if (!Number.isInteger(count) || count < 2 || count > most) {
      return fail(`Choose between 2 and ${most} qualifiers.`);
    }

    this.tournament.swiss = standings;
    this.tournament.qualifiers = ranked.slice(0, count);
    this.tournament.bracket = buildBracket(count);
    this.tournament.records = {};
    this.play.reset();
    this.play.sync(now);
    this.log(actor, now, `Built the bracket with ${count} qualifiers from ${ranked.length} players.`);
    return { ok: true, qualifiers: count };
  }

  resetBracket(actor: string, reason: string, now: Date): Result<object> {
    const denied = this.deny(actor, "rounds");
    if (denied) return denied;
    if (!this.tournament.bracket) return fail("There is no bracket to reset.");
    if (!reason.trim()) return fail("Add a reason first.");
    this.tournament.bracket = null;
    this.tournament.qualifiers = null;
    this.tournament.swiss = null;
    this.tournament.records = {};
    this.play.reset();
    this.log(actor, now, "Reset the bracket and cleared every result.", reason.trim());
    return ok;
  }

  private openMatch(matchId: string) {
    const resolved = this.resolved();
    const match = resolved?.matches[matchId];
    return match ? { match, record: this.tournament.records[matchId] } : null;
  }

  label(matchId: string): string {
    const match = this.resolved()?.matches[matchId];
    const name = (seed: number | null) =>
      seed === null ? "?" : (this.tournament.qualifiers?.[seed - 1]?.username ?? `seed ${seed}`);
    return match ? `${match.title}: ${name(match.hi)} v ${name(match.lo)}` : matchId;
  }

  /** Sets one game's result by hand, as the fallback when Lichess cannot be read. */
  recordGame(
    actor: string,
    matchId: string,
    outcome: GameOutcome,
    reason: string,
    now: Date,
  ): Result<object> {
    const denied = this.deny(actor, "result");
    if (denied) return denied;
    const found = this.openMatch(matchId);
    if (!found) return fail("That match does not exist.");
    if (!reason.trim()) return fail("Add a reason first.");
    const label = this.label(matchId);
    try {
      const next = withGame(found.match, found.record, organizerGame(outcome, reason.trim()));
      this.tournament.records[matchId] = next;
      this.play.sync(now);
      this.log(actor, now, `Set a result by hand in ${label}, game ${next.games.length}.`, reason.trim());
      return ok;
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not save that result.");
    }
  }

  /** Records who showed up. The no-show rules decide who advances. */
  recordNoShow(
    actor: string,
    matchId: string,
    present: { hi: boolean; lo: boolean },
    reason: string,
    now: Date,
  ): Result<object> {
    const denied = this.deny(actor, "forfeit");
    if (denied) return denied;
    const found = this.openMatch(matchId);
    if (!found) return fail("That match does not exist.");
    if (!reason.trim()) return fail("Add a reason first.");
    const label = this.label(matchId);
    try {
      const override = noShowOverride({
        hiPresent: present.hi,
        loPresent: present.lo,
        isFinal: matchId === this.tournament.bracket?.finalId,
        reason: reason.trim(),
        by: actor,
        at: now.toISOString(),
      });
      this.tournament.records[matchId] = withOverride(found.match, found.record, override);
      this.play.sync(now);
      this.log(actor, now, `Recorded a no-show in ${label}.`, reason.trim());
      return ok;
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not save that no-show.");
    }
  }

  undo(actor: string, matchId: string, reason: string, now: Date): Result<object> {
    const denied = this.deny(actor, "result");
    if (denied) return denied;
    const found = this.openMatch(matchId);
    if (!found?.record) return fail("There is nothing to undo in that match.");
    if (!reason.trim()) return fail("Add a reason first.");
    const label = this.label(matchId);
    const next = withUndo(found.record);
    if (next) this.tournament.records[matchId] = next;
    else delete this.tournament.records[matchId];
    this.play.sync(now);
    this.log(actor, now, `Undid the last change in ${label}.`, reason.trim());
    return ok;
  }

  endTournament(actor: string, now: Date): Result<object> {
    const denied = this.deny(actor, "admins");
    if (denied) return denied;
    if (this.tournament.status === "ended") return fail("The tournament has already ended.");
    this.tournament.status = "ended";
    this.log(actor, now, "Ended the tournament. Admin access has expired.");
    return ok;
  }

  /** The current start as date and time inputs, East Africa Time. */
  startInputs(): { date: string; time: string } {
    const start = new Date(this.tournament.startsAt);
    return { date: eastDate(start), time: eastTime(start) };
  }
}
