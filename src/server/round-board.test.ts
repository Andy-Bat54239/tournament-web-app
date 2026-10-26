import { describe, expect, it } from "vitest";
import { activeRound, countStages, roundUpdateText } from "@/domain/round-board";
import { at, setup, type World } from "@/test/fixtures";
import { buildRoundBoard } from "./round-board";

const board = (w: World, seconds: number) => buildRoundBoard(w.store, at(seconds))!;
const match = (w: World, id: string, seconds = 30) => board(w, seconds).rounds.flatMap((r) => r.matches).find((m) => m.id === id)!;

/** A referee settles a match by hand: the higher seed wins both games. */
function higherSeedWins(w: World, id: string, seconds: number) {
  for (let i = 0; i < 2; i++) expect(w.store.recordGame("Ruth", id, "hi", "test", at(seconds + i)).ok).toBe(true);
}

describe("the round board", () => {
  it("is empty until a bracket is built", () => {
    const w = setup();
    w.store.resetBracket("Joel", "test", at(5));
    expect(buildRoundBoard(w.store, at(10))).toBeNull();
  });

  it("lists every round, with the first round ready and the rest waiting", () => {
    const b = board(setup(), 30);
    expect(b.rounds.map((r) => [r.title, r.matches.length])).toEqual([["Quarterfinals", 4], ["Semifinals", 2], ["Final", 1]]);
    expect(countStages(b.rounds[0].matches)).toMatchObject({ ready: 4, waiting: 0 });
    expect(countStages(b.rounds[1].matches)).toMatchObject({ waiting: 2 });
    expect(b.rounds[0].matches[0]).toMatchObject({ title: "Quarterfinal 1", hi: "P01", lo: "P08", stage: "ready" });
    expect(b.champion).toBeNull();
    expect(b.held).toBe(false);
  });

  it("says who is ready and how long is left", () => {
    const w = setup();
    expect(match(w, "r1m1", 30).note).toBe("Game 1: Neither is ready yet. 2:30 of waiting time left.");
    w.store.play.markReady("P01", at(35));
    expect(match(w, "r1m1", 60).note).toBe("Game 1: P01 is ready, P08 is not yet. 2:00 of waiting time left.");
    w.store.play.markReady("P08", at(40));
    expect(match(w, "r1m1", 60).note).toBe("Game 1: Both are ready. 2:00 of waiting time left.");
  });

  it("shows a game being played once both players have joined", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    const link = await w.store.play.ensureLink("P01", w.lichess, at(11));
    expect(link.ok).toBe(true);
    const id = w.store.tournament.play.r1m1.round!.link!.id;
    w.lichess.simulate(id, "join", at(20));
    await w.store.play.syncGame("r1m1", w.lichess, at(21));
    expect(match(w, "r1m1", 30)).toMatchObject({ stage: "playing", note: "Game 1 is being played." });
  });

  it("flags a match that needs someone, and says why", () => {
    const w = setup();
    expect(match(w, "r1m1", 400)).toMatchObject({ stage: "flagged", note: "The waiting time is over and the game has not started." });
    expect(countStages(board(w, 400).rounds[0].matches).flagged).toBe(4);
  });

  it("shows the score of a match under way, and a decided match with how it was decided", () => {
    const w = setup();
    expect(w.store.recordGame("Ruth", "r1m1", "hi", "test", at(20)).ok).toBe(true);
    expect(match(w, "r1m1", 30).note).toMatch(/^Game 2: Neither is ready yet\. \d:\d\d of waiting time left\. Score 1–0\.$/);
    expect(w.store.recordGame("Ruth", "r1m1", "draw", "test", at(21)).ok).toBe(true);
    expect(match(w, "r1m1", 30)).toMatchObject({ stage: "decided", note: "P01 advances, 1½–½." });
    expect(w.store.recordNoShow("Ruth", "r1m2", { hi: false, lo: true }, "did not come", at(25)).ok).toBe(true);
    expect(match(w, "r1m2", 30)).toMatchObject({ stage: "decided", note: expect.stringContaining("P05 advances after a no-show") });
  });

  it("opens the next round's match once both earlier matches are decided", () => {
    const w = setup();
    higherSeedWins(w, "r1m1", 20);
    expect(match(w, "r2m1", 30).stage).toBe("waiting");
    higherSeedWins(w, "r1m2", 30);
    expect(match(w, "r2m1", 40)).toMatchObject({ stage: "ready", hi: "P01", lo: "P04" });
    expect(activeRound(board(w, 40))?.title).toBe("Quarterfinals");
  });

  it("names the champion when the final is decided", () => {
    const w = setup();
    for (const [id, s] of [["r1m1", 10], ["r1m2", 12], ["r1m3", 14], ["r1m4", 16], ["r2m1", 18], ["r2m2", 20], ["r3m1", 22]] as const) higherSeedWins(w, id, s);
    const b = board(w, 60);
    expect(b.champion).toBe("P01");
    expect(activeRound(b)).toBeNull();
    expect(roundUpdateText(b)).toContain("P01 is the champion");
  });

  it("shows every first-round match as held while the knockout is on hold, however long it is left", () => {
    const w = setup();
    w.store.resetBracket("Joel", "hold", at(1));
    const standings = w.store.registrations.map((r, i) => ({ rank: i + 1, username: r.username, points: 5 - i / 10 }));
    w.store.buildBracket("Joel", standings, { qualifiers: 8, hold: true }, at(2));
    const b = board(w, 10_000);
    expect(b.held).toBe(true);
    expect(countStages(b.rounds[0].matches)).toMatchObject({ held: 4, flagged: 0 });
    expect(b.rounds[0].matches[0].note).toBe("On hold until the knockout is started.");
    expect(roundUpdateText(b)).toContain("The Quarterfinals start soon: P01 v P08");
  });
});
