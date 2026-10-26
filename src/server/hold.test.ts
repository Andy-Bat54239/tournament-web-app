import { describe, expect, it } from "vitest";
import { at, setup, type World } from "@/test/fixtures";
import { matchScreen } from "./match-screen";
import { Store } from "./store";

/** The 8-player bracket again, built on hold at 2 seconds in. */
function heldWorld(): World {
  const w = setup();
  w.store.resetBracket("Joel", "start again, on hold", at(1));
  const standings = w.store.registrations.map((r, i) => ({ rank: i + 1, username: r.username, points: 5 - i / 10 }));
  const built = w.store.buildBracket("Joel", standings, { qualifiers: 8, hold: true }, at(2));
  if (!built.ok) throw new Error(built.error);
  return w;
}

describe("a knockout built on hold", () => {
  it("opens no match, so no waiting time is running", () => {
    const w = heldWorld();
    expect(w.store.tournament.knockoutHeld).toBe(true);
    expect(w.store.tournament.play).toEqual({});
    expect(w.store.play.openMatchOf("P01")).toBeNull();
    expect(w.store.play.markReady("P01", at(10)).ok).toBe(false);
    expect(w.store.play.desk(at(10_000))).toEqual({ items: [], problems: [] }); // however long it is left, nothing is overdue
    expect(w.store.audit.at(-1)?.action).toContain("on hold until the knockout is started");
  });

  it("shows the players who they will play, and says it has not started", () => {
    const w = heldWorld();
    expect(matchScreen(w.store, "P01", at(30))).toEqual({
      kind: "held",
      title: "Quarterfinal 1",
      name: "P01",
      seed: 1,
      opponent: { name: "P08", seed: 8 },
    });
    expect(matchScreen(w.store, "P08", at(30))).toMatchObject({ kind: "held", opponent: { name: "P01", seed: 1 } });
    expect(matchScreen(w.store, "P20", at(30))).toEqual({ kind: "not_qualified" });
  });

  it("is started by someone who builds the bracket, and not by anyone else", () => {
    const w = heldWorld();
    expect(w.store.startKnockout("Ruth", at(100)).ok).toBe(false);
    expect(w.store.startKnockout("Dan", at(100)).ok).toBe(false);
    expect(w.store.startKnockout("nobody", at(100)).ok).toBe(false);
    expect(w.store.tournament.knockoutHeld).toBe(true);
  });

  it("starts every ready match's waiting time when it is started, counted from that moment", () => {
    const w = heldWorld();
    expect(w.store.startKnockout("Joel", at(100))).toEqual({ ok: true, matches: 4 });
    expect(w.store.tournament.knockoutHeld).toBe(false);
    expect(w.store.tournament.play.r1m1.round).toMatchObject({ game: 1, startedAt: at(100).toISOString(), closesAt: at(280).toISOString() });
    expect(matchScreen(w.store, "P01", at(110))).toMatchObject({ kind: "play", window: { secondsLeft: 170 } });
    expect(w.store.audit.at(-1)).toMatchObject({ actor: "Joel", action: "Started the knockout: 4 matches are open." });
  });

  it("can be started only once, and only when there is a bracket on hold", () => {
    const w = heldWorld();
    w.store.startKnockout("Joel", at(100));
    expect(w.store.startKnockout("Joel", at(101))).toMatchObject({ ok: false, error: expect.stringContaining("already started") });

    const plain = setup(); // built without a hold
    expect(plain.store.startKnockout("Joel", at(5))).toMatchObject({ ok: false, error: expect.stringContaining("already started") });
    plain.store.resetBracket("Joel", "none", at(6));
    expect(plain.store.startKnockout("Joel", at(7))).toMatchObject({ ok: false, error: expect.stringContaining("no bracket") });
  });

  it("lets a referee still settle a match by hand, without starting the clocks", () => {
    const w = heldWorld();
    for (let i = 0; i < 2; i++) expect(w.store.recordGame("Ruth", "r1m1", "hi", "Played on another site", at(10 + i)).ok).toBe(true);
    expect(w.store.resolved()!.matches.r1m1.status).toBe("decided");
    expect(w.store.tournament.play).toEqual({});
    w.store.startKnockout("Joel", at(100));
    expect(Object.keys(w.store.tournament.play).sort()).toEqual(["r1m2", "r1m3", "r1m4"]);
  });

  it("is forgotten when the bracket is reset, so the next one starts at once", () => {
    const w = heldWorld();
    w.store.resetBracket("Joel", "again", at(50));
    expect(w.store.tournament.knockoutHeld).toBe(false);
    const standings = w.store.registrations.map((r, i) => ({ rank: i + 1, username: r.username, points: 5 - i / 10 }));
    w.store.buildBracket("Joel", standings, { qualifiers: 8 }, at(60));
    expect(Object.keys(w.store.tournament.play)).toHaveLength(4);
  });

  it("is kept when the state is saved and loaded, and a state saved before holds existed is not held", () => {
    const w = heldWorld();
    const saved = JSON.parse(JSON.stringify(w.store.snapshot()));
    expect(Store.fromState(saved, "Joel").tournament.knockoutHeld).toBe(true);
    delete saved.tournament.knockoutHeld;
    expect(Store.fromState(saved, "Joel").tournament.knockoutHeld).toBe(false);
  });
});
