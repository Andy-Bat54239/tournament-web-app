import { describe, expect, it } from "vitest";
import { buildBracket } from "./bracket";
import {
  noShowOverride,
  openMatches,
  organizerGame,
  organizerOverride,
  resolveBracket,
  withGame,
  withOverride,
  withUndo,
  type MatchRecord,
  type Override,
} from "./knockout";
import type { Game, GameOutcome } from "./match";

const AT = "2026-11-01T11:00:00.000Z";
const games = (...outcomes: GameOutcome[]): Game[] =>
  outcomes.map((outcome) => ({ outcome, source: "lichess" }));
const rec = (sides: [number, number], ...outcomes: GameOutcome[]): MatchRecord => ({
  sides,
  games: games(...outcomes),
});
const override = (outcome: Override["outcome"], kind: Override["kind"] = "organizer"): Override => ({
  outcome,
  kind,
  reason: "test",
  by: "Joel",
  at: AT,
});

// Eight qualifiers, as in the prototype: 1v8, 4v5, 2v7, 3v6 -> semifinals -> final.
const eight = buildBracket(8);

describe("resolveBracket", () => {
  it("starts with the first round ready and the rest waiting", () => {
    const r = resolveBracket(eight, {});
    expect(["r1m1", "r1m2", "r1m3", "r1m4"].map((id) => r.matches[id].status)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    expect(r.matches.r1m2).toMatchObject({ hi: 4, lo: 5 });
    expect(r.matches.r2m1.status).toBe("waiting");
    expect(r.matches.r3m1.status).toBe("waiting");
    expect(r.champion).toBeNull();
  });

  it("rolls: a match is ready as soon as both feeders are decided", () => {
    const first = resolveBracket(eight, { r1m1: rec([1, 8], "hi", "hi") });
    expect(first.matches.r1m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "score" });
    expect(first.matches.r2m1.status).toBe("waiting");

    const both = resolveBracket(eight, {
      r1m1: rec([1, 8], "hi", "hi"),
      r1m2: rec([4, 5], "lo", "lo"),
    });
    expect(both.matches.r2m1).toMatchObject({ status: "ready", hi: 1, lo: 5 });
    // The other half has not started and is not held up by this one.
    expect(both.matches.r1m3.status).toBe("ready");
  });

  it("tracks a match in progress", () => {
    const r = resolveBracket(eight, { r1m1: rec([1, 8], "hi") });
    expect(r.matches.r1m1).toMatchObject({ status: "in_progress", winner: null });
    expect(r.matches.r1m1.score?.next).toMatchObject({ game: 2, white: "lo" });
  });

  it("crowns a champion when the final is decided", () => {
    const r = resolveBracket(eight, {
      r1m1: rec([1, 8], "hi", "hi"),
      r1m2: rec([4, 5], "hi", "hi"),
      r1m3: rec([2, 7], "lo", "lo"),
      r1m4: rec([3, 6], "hi", "lo", "lo"),
      r2m1: rec([1, 4], "hi", "hi"),
      r2m2: rec([6, 7], "lo", "hi", "draw", "lo", "hi"), // level after five: higher seed (6)
      r3m1: rec([1, 6], "lo", "hi", "lo"),
    });
    expect(r.matches.r2m2).toMatchObject({ winner: 6, decidedBy: "higher_seed" });
    expect(r.matches.r3m1).toMatchObject({ winner: 6, decidedBy: "score" });
    expect(r.champion).toBe(6);
    expect(openMatches(eight, r)).toEqual([]);
  });

  it("gives byes to the top seeds when there are too few qualifiers", () => {
    const five = buildBracket(5);
    const r = resolveBracket(five, {});
    expect(r.matches.r1m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "walkover" });
    expect(r.matches.r1m3).toMatchObject({ winner: 2, decidedBy: "walkover" });
    expect(r.matches.r1m4).toMatchObject({ winner: 3, decidedBy: "walkover" });
    expect(r.matches.r1m2.status).toBe("ready"); // 4 v 5 is the only real first-round match
    expect(r.matches.r2m1.status).toBe("waiting");
    expect(r.matches.r2m2).toMatchObject({ status: "ready", hi: 2, lo: 3 });

    const after = resolveBracket(five, { r1m2: rec([4, 5], "lo", "hi", "hi") });
    expect(after.matches.r2m1).toMatchObject({ status: "ready", hi: 1, lo: 4 });
  });

  describe("no-shows", () => {
    it("one player shows: that player wins, whatever their seed", () => {
      const r = resolveBracket(eight, {
        r1m1: { sides: [1, 8], games: [], override: override("lo", "no_show") },
      });
      expect(r.matches.r1m1).toMatchObject({ winner: 8, decidedBy: "no_show" });
    });

    it("neither shows: both are out and the waiting opponent advances", () => {
      const r = resolveBracket(eight, {
        r1m1: rec([1, 8], "hi", "hi"),
        r1m2: { sides: [4, 5], games: [], override: override("none", "double_no_show") },
      });
      expect(r.matches.r1m2).toMatchObject({ status: "decided", winner: null, decidedBy: "double_no_show" });
      expect(r.matches.r2m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "walkover" });
    });

    it("chains: two empty feeders leave nobody to advance", () => {
      const r = resolveBracket(eight, {
        r1m1: { sides: [1, 8], games: [], override: override("none", "double_no_show") },
        r1m2: { sides: [4, 5], games: [], override: override("none", "double_no_show") },
      });
      expect(r.matches.r2m1).toMatchObject({ status: "decided", winner: null, decidedBy: "empty" });
      expect(r.matches.r3m1.status).toBe("waiting"); // still waiting on the other half
    });

    it("final only: if neither shows, the higher seed wins", () => {
      const noShow = noShowOverride({
        hiPresent: false,
        loPresent: false,
        isFinal: true,
        reason: "Neither player appeared",
        by: "Ruth",
        at: AT,
      });
      const r = resolveBracket(buildBracket(2), { r1m1: { sides: [1, 2], games: [], override: noShow } });
      expect(r.matches.r1m1).toMatchObject({ winner: 1, decidedBy: "double_no_show" });
      expect(r.champion).toBe(1);
    });

    it("still gives the final to the higher seed if a bare 'neither' override reaches it", () => {
      const r = resolveBracket(buildBracket(2), {
        r1m1: { sides: [1, 2], games: [], override: override("none", "double_no_show") },
      });
      expect(r.champion).toBe(1);
    });
  });

  it("lets an override replace games already played", () => {
    const r = resolveBracket(eight, {
      r1m1: { sides: [1, 8], games: games("hi"), override: override("lo") },
    });
    expect(r.matches.r1m1).toMatchObject({ winner: 8, decidedBy: "organizer" });
  });

  it("ignores a record made for different players", () => {
    const before = resolveBracket(eight, {
      r1m1: rec([1, 8], "hi", "hi"),
      r1m2: rec([4, 5], "hi", "hi"),
      r2m1: rec([1, 4], "hi", "hi"),
    });
    expect(before.matches.r2m1.winner).toBe(1);

    // The referee corrects the 4 v 5 result, so the semifinal is now 1 v 5.
    const after = resolveBracket(eight, {
      r1m1: rec([1, 8], "hi", "hi"),
      r1m2: rec([4, 5], "lo", "lo"),
      r2m1: rec([1, 4], "hi", "hi"),
    });
    expect(after.matches.r2m1).toMatchObject({ hi: 1, lo: 5, status: "ready", winner: null, stale: true });
  });
});

describe("recording results", () => {
  const ready = resolveBracket(eight, {}).matches.r1m1;

  it("adds a game to a fresh match", () => {
    const record = withGame(ready, undefined, organizerGame("draw", "Lichess was down"));
    expect(record).toEqual({
      sides: [1, 8],
      games: [{ outcome: "draw", source: "organizer", reason: "Lichess was down" }],
    });
  });

  it("refuses results for matches that are waiting or decided", () => {
    const resolved = resolveBracket(eight, { r1m1: rec([1, 8], "hi", "hi") });
    expect(() => withGame(resolved.matches.r2m1, undefined, organizerGame("hi", "x"))).toThrow(/waiting/);
    expect(() => withGame(resolved.matches.r1m1, rec([1, 8], "hi", "hi"), organizerGame("hi", "x"))).toThrow(
      /decided/,
    );
  });

  it("starts a fresh record when the old one is stale", () => {
    const stale = resolveBracket(eight, {
      r1m1: rec([1, 8], "hi", "hi"),
      r1m2: rec([4, 5], "lo", "lo"),
      r2m1: rec([1, 4], "hi"),
    }).matches.r2m1;
    const record = withGame(stale, rec([1, 4], "hi"), organizerGame("lo", "new pairing"));
    expect(record.sides).toEqual([1, 5]);
    expect(record.games).toHaveLength(1);
  });

  it("undoes the last game, or the override first", () => {
    expect(withUndo(undefined)).toBeNull();
    expect(withUndo(rec([1, 8], "hi"))).toBeNull();
    expect(withUndo(rec([1, 8], "hi", "lo", "draw"))).toEqual(rec([1, 8], "hi", "lo"));

    const withBoth = { ...rec([1, 8], "hi"), override: override("lo") };
    expect(withUndo(withBoth)).toEqual(rec([1, 8], "hi"));
    expect(withUndo({ sides: [1, 8], games: [], override: override("lo") })).toBeNull();
  });

  it("applies an organizer override to an open match", () => {
    const record = withOverride(
      ready,
      undefined,
      organizerOverride("hi", { reason: "Wrong result read", by: "Ruth", at: AT }),
    );
    expect(resolveBracket(eight, { r1m1: record }).matches.r1m1).toMatchObject({
      winner: 1,
      decidedBy: "organizer",
    });
  });
});

describe("noShowOverride", () => {
  const meta = { reason: "No-show", by: "Ruth", at: AT, isFinal: false };

  it("awards the match to whoever showed", () => {
    expect(noShowOverride({ ...meta, hiPresent: true, loPresent: false })).toMatchObject({
      outcome: "hi",
      kind: "no_show",
    });
    expect(noShowOverride({ ...meta, hiPresent: false, loPresent: true })).toMatchObject({
      outcome: "lo",
      kind: "no_show",
    });
  });

  it("knocks both out when neither shows, except in the final", () => {
    expect(noShowOverride({ ...meta, hiPresent: false, loPresent: false })).toMatchObject({
      outcome: "none",
      kind: "double_no_show",
    });
    expect(noShowOverride({ ...meta, isFinal: true, hiPresent: false, loPresent: false })).toMatchObject({
      outcome: "hi",
      kind: "double_no_show",
    });
  });

  it("is not a no-show if both players showed", () => {
    expect(() => noShowOverride({ ...meta, hiPresent: true, loPresent: true })).toThrow();
  });
});
