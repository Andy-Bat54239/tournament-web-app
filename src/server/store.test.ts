import { describe, expect, it } from "vitest";
import { PRESETS } from "@/domain/permissions";
import type { Registration } from "@/domain/registration";
import { MockLichess } from "./lichess/mock";
import type { StandingRow } from "./lichess/types";
import { Store } from "./store";

const eat = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);
const EARLY = eat("2026-10-26", "10:00"); // sign-ups open
const CHECK_IN = eat("2026-11-01", "13:10"); // check-in open
const LATE = eat("2026-11-01", "13:50"); // check-in closed
const GOOD_PHONE = "+256 772 123 456";

function player(i: number, over: Partial<Registration> = {}): Registration {
  const at = new Date(Date.UTC(2026, 9, 24, 8, i)).toISOString();
  return {
    username: `P${String(i + 1).padStart(2, "0")}`,
    rating: 2000 - i * 10,
    whatsapp: "+256700000000",
    consentAt: at,
    teamJoined: true,
    checkedIn: true,
    status: "registered",
    joinedAt: at,
    ...over,
  };
}

function makeStore(players = 0, cap = 64): Store {
  return new Store({
    superAdmin: "Joel",
    registrations: Array.from({ length: players }, (_, i) => player(i)),
    admins: [
      { username: "Ruth", preset: "referee", grants: [...PRESETS.referee] },
      { username: "Dan", preset: "desk", grants: [...PRESETS.desk] },
    ],
    tournament: {
      name: "Test",
      startsAt: eat("2026-11-01", "14:00").toISOString(),
      cap,
      status: "open",
      scheduleChange: null,
      announcement: null,
      swiss: null,
      qualifiers: null,
      bracket: null,
      records: {},
      play: {},
    },
  });
}

const standingsFor = (store: Store): StandingRow[] =>
  store.registrations.map((r, i) => ({ rank: i + 1, username: r.username, points: 5 - i / 10 }));

describe("sign-up", () => {
  const profile = { username: "Mercy_K", blitzRating: 1722, provisional: false };

  it("signs a player up with their rating, number and consent", () => {
    const store = makeStore(41);
    const result = store.signUp(profile, GOOD_PHONE, true, EARLY);
    expect(result).toEqual({ ok: true, status: "registered", position: 42 });
    expect(store.registration("mercy_k")).toMatchObject({
      username: "Mercy_K",
      rating: 1722,
      whatsapp: "+256772123456",
      consentAt: EARLY.toISOString(),
    });
  });

  it("checks the phone number and the rules box", () => {
    const store = makeStore();
    expect(store.signUp(profile, "0772123456", true, EARLY)).toEqual({
      ok: false,
      error: "Use the format +256 7XX XXX XXX.",
    });
    expect(store.signUp(profile, GOOD_PHONE, false, EARLY)).toEqual({
      ok: false,
      error: "Tick the box to accept the rules.",
    });
    expect(store.registrations).toHaveLength(0);
  });

  it("stores a new player's missing rating as null", () => {
    const store = makeStore();
    store.signUp({ username: "Newbie", blitzRating: null, provisional: true }, GOOD_PHONE, true, EARLY);
    expect(store.registration("Newbie")?.rating).toBeNull();
  });

  it("sends players to the waitlist once the cap is reached", () => {
    const store = makeStore(2, 2);
    expect(store.signUp(profile, GOOD_PHONE, true, EARLY)).toEqual({ ok: true, status: "waitlisted", position: 1 });
  });

  it("closes the night before the start", () => {
    const store = makeStore();
    expect(store.signUp(profile, GOOD_PHONE, true, eat("2026-11-01", "00:01"))).toEqual({
      ok: false,
      error: "Sign-ups are closed.",
    });
  });
});

describe("check-in and withdrawing", () => {
  it("opens one hour before the start and closes 15 minutes before", () => {
    const store = makeStore(0);
    store.registrations = [player(0, { checkedIn: false })];
    expect(store.checkIn("P01", EARLY)).toEqual({ ok: false, error: "Check-in opens at 13:00." });
    expect(store.checkIn("P01", LATE)).toEqual({ ok: false, error: "Check-in is closed." });
    expect(store.checkIn("P01", CHECK_IN)).toEqual({ ok: true });
    expect(store.registration("P01")?.checkedIn).toBe(true);
  });

  it("lets players withdraw until the deadline", () => {
    const store = makeStore(3);
    expect(store.withdraw("P01", EARLY)).toEqual({ ok: true });
    expect(store.withdraw("P02", LATE).ok).toBe(false);
  });

  it("reopens withdrawing after a schedule change", () => {
    const store = makeStore(3);
    store.changeSchedule("Joel", { date: "2026-11-08", time: "14:00", reason: "Venue clash" }, EARLY);
    expect(store.withdraw("P01", eat("2026-11-08", "13:50"))).toEqual({ ok: true });
  });

  it("removes no-shows and promotes the waitlist, for the desk only", () => {
    const store = makeStore(0, 3);
    store.registrations = [
      player(0),
      player(1, { checkedIn: false }),
      player(2, { checkedIn: false }),
      player(3, { status: "waitlisted", checkedIn: false }),
    ];
    expect(store.removeNoShows("Ruth", LATE)).toEqual({ ok: false, error: "You don’t have access to that." });
    expect(store.removeNoShows("Dan", LATE)).toEqual({ ok: true, removed: ["P02", "P03"], promoted: ["P04"] });
    expect(store.audit.at(-1)).toMatchObject({ actor: "Dan", action: expect.stringContaining("Removed 2") });
  });
});

describe("changing the schedule", () => {
  it("recalculates the times, notes the change and writes the announcement", () => {
    const store = makeStore();
    const result = store.changeSchedule(
      "Joel",
      { date: "2026-11-08", time: "15:30", reason: "Venue clash" },
      EARLY,
    );
    expect(result).toEqual({ ok: true });
    expect(store.startInputs()).toEqual({ date: "2026-11-08", time: "15:30" });
    expect(store.tournament.scheduleChange).toMatchObject({
      from: eat("2026-11-01", "14:00").toISOString(),
      to: eat("2026-11-08", "15:30").toISOString(),
      by: "Joel",
      reason: "Venue clash",
    });
    expect(store.tournament.announcement?.text).toBe(
      "Schedule update: Castle Connect tournament starts Sunday 8 November, 15:30 (East Africa Time). " +
        "Check-in opens at 14:30. Open the app to see your match.",
    );
    expect(store.audit).toEqual([
      expect.objectContaining({
        actor: "Joel",
        action: "Schedule changed from Sunday 1 November, 14:00 to Sunday 8 November, 15:30.",
        reason: "Venue clash",
      }),
    ]);
  });

  it("needs a real date and time, a change, and a reason", () => {
    const store = makeStore();
    const change = (date: string, time: string, reason: string) =>
      store.changeSchedule("Joel", { date, time, reason }, EARLY);
    expect(change("", "", "x")).toEqual({ ok: false, error: "Enter both a date and a time." });
    expect(change("2026-11-01", "14:00", "x")).toEqual({ ok: false, error: "That is already the start time." });
    expect(change("2026-11-08", "14:00", "  ")).toEqual({ ok: false, error: "Add a reason for the change." });
    expect(store.tournament.scheduleChange).toBeNull();
  });

  it("is only for admins who were given the setting", () => {
    const store = makeStore();
    const input = { date: "2026-11-08", time: "14:00", reason: "x" };
    expect(store.changeSchedule("Ruth", input, EARLY).ok).toBe(false);
    expect(store.changeSchedule("a_stranger", input, EARLY).ok).toBe(false);

    store.admins[0].grants.push("settings");
    expect(store.changeSchedule("Ruth", input, EARLY).ok).toBe(true);
  });

  it("lets an organizer confirm the announcement was sent", () => {
    const store = makeStore();
    expect(store.markAnnouncementSent("Dan", EARLY).ok).toBe(false); // nothing to send yet
    store.changeSchedule("Joel", { date: "2026-11-08", time: "14:00", reason: "x" }, EARLY);
    expect(store.markAnnouncementSent("Dan", EARLY)).toEqual({ ok: true });
    expect(store.tournament.announcement?.sentAt).toBe(EARLY.toISOString());
    expect(store.markAnnouncementSent("a_stranger", EARLY).ok).toBe(false);
  });
});

describe("building the bracket", () => {
  it("takes the top 32 of a 41-player Swiss, seeded by Lichess rank", async () => {
    const store = makeStore(41);
    const standings = await new MockLichess().getSwissStandings({
      swissId: null,
      entrants: store.registrations.map((r) => r.username),
    });
    const result = store.buildBracket("Joel", standings, {}, LATE);
    expect(result).toEqual({ ok: true, qualifiers: 32 });

    const { qualifiers, bracket } = store.tournament;
    expect(qualifiers).toHaveLength(32);
    expect(qualifiers?.map((q) => q.seed)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(qualifiers?.map((q) => q.swissRank)).toEqual(standings.slice(0, 32).map((s) => s.rank));
    expect(bracket?.rounds.map((r) => r.length)).toEqual([16, 8, 4, 2, 1]);
  });

  it("builds a demo-sized bracket when asked for fewer qualifiers", () => {
    const store = makeStore(41);
    expect(store.buildBracket("Joel", standingsFor(store), { qualifiers: 8 }, LATE)).toEqual({
      ok: true,
      qualifiers: 8,
    });
    expect(store.resolved()?.matches.r1m1).toMatchObject({ hi: 1, lo: 8, status: "ready" });
  });

  it("takes seeds from the rank Lichess gives, not from sign-up order or rating", () => {
    const store = makeStore(20);
    const standings = standingsFor(store).reverse().map((s, i) => ({ ...s, rank: i + 1 }));
    store.buildBracket("Joel", standings, { qualifiers: 4 }, LATE);
    expect(store.tournament.qualifiers?.map((q) => q.username)).toEqual(["P20", "P19", "P18", "P17"]);
  });

  it("ignores Swiss entrants who are not registered", () => {
    const store = makeStore(20);
    const standings = [{ rank: 1, username: "Stranger", points: 5 }, ...standingsFor(store).map((s) => ({ ...s, rank: s.rank + 1 }))];
    store.buildBracket("Joel", standings, { qualifiers: 4 }, LATE);
    expect(store.tournament.qualifiers?.map((q) => q.username)).toEqual(["P01", "P02", "P03", "P04"]);
  });

  it("runs 16 or fewer players as a straight knockout, seeded by rating", () => {
    const store = makeStore(0);
    store.registrations = [player(0, { rating: 1200 }), player(1, { rating: 1900 }), player(2, { rating: null }), player(3, { rating: 1500 })];
    expect(store.buildBracket("Joel", null, {}, LATE)).toEqual({ ok: true, qualifiers: 4 });
    expect(store.tournament.qualifiers?.map((q) => [q.seed, q.username, q.swissRank])).toEqual([
      [1, "P02", null],
      [2, "P04", null],
      [3, "P01", null],
      [4, "P03", null],
    ]);
  });

  it("refuses without standings, with a bad count, twice, or for the wrong person", () => {
    const store = makeStore(41);
    expect(store.buildBracket("Joel", null, {}, LATE)).toEqual({ ok: false, error: "The Swiss standings are not available yet." });
    expect(store.buildBracket("Joel", standingsFor(store), { qualifiers: 1 }, LATE).ok).toBe(false);
    expect(store.buildBracket("Joel", standingsFor(store), { qualifiers: 33 }, LATE).ok).toBe(false);
    expect(store.buildBracket("Ruth", standingsFor(store), {}, LATE).ok).toBe(false);
    expect(store.buildBracket("Joel", standingsFor(store), {}, LATE).ok).toBe(true);
    expect(store.buildBracket("Joel", standingsFor(store), {}, LATE)).toEqual({ ok: false, error: "The bracket is already built." });
  });

  it("needs at least two players", () => {
    expect(makeStore(1).buildBracket("Joel", null, {}, LATE).ok).toBe(false);
  });
});

describe("recording results", () => {
  function eightPlayerBracket() {
    const store = makeStore(20);
    store.buildBracket("Joel", standingsFor(store), { qualifiers: 8 }, LATE);
    return store;
  }

  it("records a result by hand, with the reason in the audit log", () => {
    const store = eightPlayerBracket();
    expect(store.recordGame("Ruth", "r1m1", "hi", "Lichess was down", LATE)).toEqual({ ok: true });
    expect(store.recordGame("Ruth", "r1m1", "hi", "Lichess was down", LATE)).toEqual({ ok: true });
    expect(store.resolved()?.matches.r1m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "score" });
    expect(store.audit.at(-1)).toEqual({
      at: LATE.toISOString(),
      actor: "Ruth",
      action: "Set a result by hand in Quarterfinal 1: P01 v P08, game 2.",
      reason: "Lichess was down",
    });
  });

  it("rolls into the next round as soon as both feeders finish", () => {
    const store = eightPlayerBracket();
    for (const id of ["r1m1", "r1m2"]) {
      store.recordGame("Ruth", id, "hi", "x", LATE);
      store.recordGame("Ruth", id, "hi", "x", LATE);
    }
    expect(store.resolved()?.matches.r2m1).toMatchObject({ status: "ready", hi: 1, lo: 4 });
    expect(store.resolved()?.matches.r2m2.status).toBe("waiting");
  });

  it("needs a reason, a match that exists, and permission", () => {
    const store = eightPlayerBracket();
    expect(store.recordGame("Ruth", "r1m1", "hi", " ", LATE)).toEqual({ ok: false, error: "Add a reason first." });
    expect(store.recordGame("Ruth", "nope", "hi", "x", LATE)).toEqual({ ok: false, error: "That match does not exist." });
    expect(store.recordGame("Dan", "r1m1", "hi", "x", LATE).ok).toBe(false); // desk cannot set results
    expect(store.recordGame("Ruth", "r2m1", "hi", "x", LATE).ok).toBe(false); // still waiting
    expect(store.audit.filter((a) => a.action.startsWith("Set a result"))).toHaveLength(0);
  });

  it("applies the no-show rules", () => {
    const store = eightPlayerBracket();
    expect(store.recordNoShow("Ruth", "r1m1", { hi: false, lo: true }, "P01 never appeared", LATE)).toEqual({ ok: true });
    expect(store.resolved()?.matches.r1m1).toMatchObject({ winner: 8, decidedBy: "no_show" });

    store.recordNoShow("Ruth", "r1m2", { hi: false, lo: false }, "Neither appeared", LATE);
    expect(store.resolved()?.matches.r1m2).toMatchObject({ winner: null, decidedBy: "double_no_show" });
    // The waiting opponent in the next round advances.
    expect(store.resolved()?.matches.r2m1).toMatchObject({ status: "decided", winner: 8, decidedBy: "walkover" });

    expect(store.recordNoShow("Ruth", "r1m3", { hi: true, lo: true }, "x", LATE).ok).toBe(false);
    expect(store.recordNoShow("Dan", "r1m3", { hi: true, lo: false }, "x", LATE).ok).toBe(false);
  });

  it("gives the final to the higher seed if neither player shows", () => {
    const store = makeStore(4);
    store.buildBracket("Joel", null, {}, LATE); // 4 players: semis, then final
    for (const id of ["r1m1", "r1m2"]) {
      store.recordGame("Ruth", id, "hi", "x", LATE);
      store.recordGame("Ruth", id, "hi", "x", LATE);
    }
    store.recordNoShow("Ruth", "r2m1", { hi: false, lo: false }, "Neither appeared", LATE);
    expect(store.resolved()?.matches.r2m1).toMatchObject({ winner: 1, decidedBy: "double_no_show" });
    expect(store.resolved()?.champion).toBe(1);
  });

  it("undoes the last change", () => {
    const store = eightPlayerBracket();
    store.recordGame("Ruth", "r1m1", "hi", "x", LATE);
    store.recordGame("Ruth", "r1m1", "hi", "x", LATE);
    expect(store.undo("Ruth", "r1m1", "Entered by mistake", LATE)).toEqual({ ok: true });
    expect(store.resolved()?.matches.r1m1).toMatchObject({ status: "in_progress", winner: null });
    expect(store.undo("Ruth", "r1m1", "Entered by mistake", LATE).ok).toBe(true);
    expect(store.undo("Ruth", "r1m1", "again", LATE)).toEqual({ ok: false, error: "There is nothing to undo in that match." });
    expect(store.undo("Ruth", "r1m2", " ", LATE).ok).toBe(false);
  });

  it("resets the whole bracket only with a reason", () => {
    const store = eightPlayerBracket();
    store.recordGame("Ruth", "r1m1", "hi", "x", LATE);
    expect(store.resetBracket("Ruth", "x", LATE).ok).toBe(false);
    expect(store.resetBracket("Joel", "", LATE).ok).toBe(false);
    expect(store.resetBracket("Joel", "Wrong cut-off", LATE)).toEqual({ ok: true });
    expect(store.tournament.bracket).toBeNull();
    expect(store.tournament.records).toEqual({});
  });
});

describe("roles", () => {
  it("recognises the super admin and the assigned admins, ignoring case", () => {
    const store = makeStore();
    expect(store.access("joel")).toMatchObject({ superAdmin: true });
    expect(store.access("RUTH")).toMatchObject({ superAdmin: false, grants: PRESETS.referee });
    expect(store.access("someone")).toBeNull();
    expect(store.access(null)).toBeNull();
  });

  it("expires admin access when the tournament ends, but not the super admin's", () => {
    const store = makeStore();
    expect(store.can("Ruth", "result")).toBe(true);
    expect(store.endTournament("Ruth", LATE).ok).toBe(false);
    expect(store.endTournament("Joel", LATE)).toEqual({ ok: true });
    expect(store.can("Ruth", "result")).toBe(false);
    expect(store.can("Dan", "roster")).toBe(false);
    expect(store.can("Joel", "result")).toBe(true);
    expect(store.endTournament("Joel", LATE).ok).toBe(false);
  });

  it("has no super admin when none is configured", () => {
    const store = new Store({ ...{ superAdmin: null }, tournament: makeStore().tournament });
    expect(store.access("Joel")).toBeNull();
  });
});
