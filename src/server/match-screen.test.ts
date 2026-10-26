import { describe, expect, it } from "vitest";
import { at, setup, type World } from "@/test/fixtures";
import { matchScreen } from "./match-screen";

const screen = (w: World, who: string, seconds = 30) => matchScreen(w.store, who, at(seconds));

/** A referee settles a match by hand: the higher seed wins both games. */
function higherSeedWins(w: World, matchId: string, seconds = 40) {
  for (let i = 0; i < 2; i++) expect(w.store.recordGame("Ruth", matchId, "hi", "test", at(seconds + i)).ok).toBe(true);
}

describe("before and outside the bracket", () => {
  it("says so when there is no bracket yet", () => {
    const w = setup();
    w.store.resetBracket("Joel", "test", at(5));
    expect(screen(w, "P01")).toEqual({ kind: "no_bracket" });
  });

  it("says so to a player who did not qualify", () => {
    const w = setup();
    expect(screen(w, "P20")).toEqual({ kind: "not_qualified" });
    expect(screen(w, "nobody")).toEqual({ kind: "not_qualified" });
  });
});

describe("a match to play", () => {
  it("shows the opponent, the seeds, the game and who has White", () => {
    const w = setup();
    const higher = screen(w, "P01");
    expect(higher).toMatchObject({
      kind: "play",
      isFinal: false,
      me: { name: "P01", seed: 1, side: "hi" },
      opponent: { name: "P08", seed: 8 },
      game: { number: 1, whiteName: "P01", youAreWhite: true, note: "" },
    });
    expect(screen(w, "P08")).toMatchObject({
      me: { name: "P08", side: "lo" },
      opponent: { name: "P01", seed: 1 },
      game: { whiteName: "P01", youAreWhite: false },
    });
  });

  it("counts down the 3-minute waiting time and shows when it is over", () => {
    const w = setup();
    expect(screen(w, "P01", 30)).toMatchObject({ window: { secondsLeft: 150, over: false } });
    expect(screen(w, "P01", 179)).toMatchObject({ window: { secondsLeft: 1, over: false } });
    expect(screen(w, "P01", 200)).toMatchObject({ window: { secondsLeft: 0, over: true } });
  });

  it("never carries a phone number or anything private about the opponent", () => {
    const w = setup();
    const json = JSON.stringify(screen(w, "P01"));
    expect(json).not.toContain("+256");
    expect(json).not.toContain("whatsapp");
  });

  it("gives the game link only to a player who has tapped ready", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    await w.store.play.ensureLink("P01", w.lichess, at(11));
    const url = (screen(w, "P01") as { link: string | null }).link;
    expect(url).toMatch(/^https:\/\/lichess\.org\/mock\d+$/);
    expect(screen(w, "P08")).toMatchObject({ link: null, ready: { me: false, opponent: true } });
    w.store.play.markReady("P08", at(20));
    expect(screen(w, "P08")).toMatchObject({ link: url, ready: { me: true, opponent: true } });
  });

  it("says why a win cannot be claimed yet, then allows it", () => {
    const w = setup();
    expect(screen(w, "P01", 10)).toMatchObject({ claimBlocked: expect.stringContaining("ready first") });
    w.store.play.markReady("P01", at(10));
    expect(screen(w, "P01", 100)).toMatchObject({ claimBlocked: "The waiting time is not over yet." });
    expect(screen(w, "P01", 200)).toMatchObject({ claimBlocked: null });
    w.store.play.markReady("P08", at(210));
    expect(screen(w, "P01", 220)).toMatchObject({ claimBlocked: expect.stringContaining("opponent is ready") });
  });

  it("shows a claim to both players, from each one's point of view", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    await w.store.play.claimWin("P01", w.lichess, at(200));
    expect(screen(w, "P01", 210)).toMatchObject({ claim: { by: "me" }, claimBlocked: "Your claim is with a referee." });
    expect(screen(w, "P08", 210)).toMatchObject({ claim: { by: "opponent" } });
  });

  it("flips the colours in game 2 and explains the tiebreak games", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(5));
    await w.store.play.ensureLink("P01", w.lichess, at(6));
    const id = w.store.tournament.play.r1m1.round!.link!.id;
    w.lichess.simulate(id, "join", at(10));
    w.lichess.simulate(id, "white", at(100));
    await w.store.play.syncGame("r1m1", w.lichess, at(101));
    expect(screen(w, "P01", 110)).toMatchObject({
      game: { number: 2, whiteName: "P08", youAreWhite: false, note: "" },
      games: [{ outcome: "hi", source: "lichess" }],
    });

    // Game 2: the lower seed has White and wins, so it is level and game 3 decides.
    w.store.play.markReady("P01", at(111));
    await w.store.play.ensureLink("P01", w.lichess, at(112));
    const second = w.store.tournament.play.r1m1.round!.link!.id;
    w.lichess.simulate(second, "join", at(115));
    w.lichess.simulate(second, "white", at(200));
    await w.store.play.syncGame("r1m1", w.lichess, at(201));
    expect(screen(w, "P08", 210)).toMatchObject({
      game: { number: 3, whiteName: "P01", youAreWhite: false, note: "Tied after two games, so game 3 decides." },
    });
  });

  it("shows a referee note when Lichess reported something odd", () => {
    const w = setup();
    w.store.tournament.play.r1m1.round!.refereeNote = 'Lichess reported "unknownFinish" with no winner.';
    expect(screen(w, "P01")).toMatchObject({ refereeNote: expect.stringContaining("unknownFinish") });
  });

  it("counts aborted games", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(5));
    await w.store.play.ensureLink("P01", w.lichess, at(6));
    const id = w.store.tournament.play.r1m1.round!.link!.id;
    w.lichess.simulate(id, "join", at(10));
    w.lichess.simulate(id, "abort", at(20));
    await w.store.play.syncGame("r1m1", w.lichess, at(21));
    expect(screen(w, "P01", 30)).toMatchObject({ aborts: 1, game: { number: 1 }, ready: { me: false }, link: null });
  });
});

describe("after the match", () => {
  it("tells a player who has advanced to wait for the next opponent", () => {
    const w = setup();
    higherSeedWins(w, "r1m1");
    expect(screen(w, "P01", 60)).toEqual({ kind: "waiting", title: "Semifinal 1", name: "P01", seed: 1 });
  });

  it("brings the next match up as soon as the other feeder is decided, with a new 3-minute wait", () => {
    const w = setup();
    higherSeedWins(w, "r1m1");
    higherSeedWins(w, "r1m2", 50); // P04 beats P05
    expect(screen(w, "P01", 60)).toMatchObject({
      kind: "play",
      match: { title: "Semifinal 1" },
      opponent: { name: "P04", seed: 4 },
      window: { secondsLeft: 171, over: false }, // the deciding game was recorded at 51 s, so the wait ends at 231 s
    });
  });

  it("tells a knocked-out player who beat them", () => {
    const w = setup();
    higherSeedWins(w, "r1m1");
    expect(screen(w, "P08", 60)).toEqual({ kind: "out", title: "Quarterfinal 1", winnerName: "P01", how: "" });
  });

  it("says how the opponent advanced when it was not by the score", () => {
    const w = setup();
    w.store.recordNoShow("Ruth", "r1m1", { hi: true, lo: false }, "P08 did not appear", at(40));
    expect(screen(w, "P08", 60)).toMatchObject({ kind: "out", winnerName: "P01", how: "after a no-show" });
    w.store.recordGame("Ruth", "r1m2", "hi", "x", at(41));
    w.store.recordGame("Ruth", "r1m2", "lo", "x", at(42));
    w.store.recordGame("Ruth", "r1m2", "draw", "x", at(43));
    w.store.recordGame("Ruth", "r1m2", "draw", "x", at(44));
    w.store.recordGame("Ruth", "r1m2", "draw", "x", at(45));
    expect(screen(w, "P05", 60)).toMatchObject({ kind: "out", winnerName: "P04", how: "as the higher seed" });
  });

  it("tells both players they are out when neither appeared", () => {
    const w = setup();
    w.store.recordNoShow("Ruth", "r1m1", { hi: false, lo: false }, "Neither came", at(40));
    expect(screen(w, "P01", 60)).toEqual({ kind: "out", title: "Quarterfinal 1", winnerName: null, how: "" });
    expect(screen(w, "P08", 60)).toMatchObject({ kind: "out", winnerName: null });
  });

  it("names the champion, and marks the final", () => {
    const w = setup();
    for (const id of ["r1m1", "r1m2", "r1m3", "r1m4"]) higherSeedWins(w, id);
    higherSeedWins(w, "r2m1");
    higherSeedWins(w, "r2m2");
    expect(screen(w, "P01", 90)).toMatchObject({ kind: "play", isFinal: true, opponent: { name: "P02" } });
    higherSeedWins(w, "r3m1");
    expect(screen(w, "P01", 100)).toEqual({ kind: "champion", name: "P01" });
    expect(screen(w, "P02", 100)).toMatchObject({ kind: "out", title: "Final", winnerName: "P01" });
  });
});
