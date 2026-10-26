import { describe, expect, it } from "vitest";
import { T0, at, setup, type World } from "@/test/fixtures";
import { MockLichess, type SimulatedEvent } from "./lichess/mock";
import type { LichessGame } from "./lichess/types";

const round = (w: World, matchId: string) => w.store.tournament.play[matchId]?.round;

async function readyAndLink(w: World, who: string, now = at(10)) {
  expect(w.store.play.markReady(who, now).ok).toBe(true);
  const link = await w.store.play.ensureLink(who, w.lichess, now);
  if (!link.ok) throw new Error(link.error);
  return link.url;
}

/** Both players join the game, then it ends as given. */
async function playOut(w: World, matchId: string, event: SimulatedEvent, when: number) {
  const id = round(w, matchId)!.link!.id;
  w.lichess.simulate(id, "join", at(when - 60));
  w.lichess.simulate(id, event, at(when));
  return w.store.play.syncGame(matchId, w.lichess, at(when + 5));
}

describe("the waiting time", () => {
  it("starts when a match becomes ready: 3 minutes for game 1", () => {
    const w = setup();
    for (const id of ["r1m1", "r1m2", "r1m3", "r1m4"]) {
      expect(round(w, id)).toMatchObject({ game: 1, startedAt: T0.toISOString(), closesAt: at(180).toISOString(), ready: {} });
    }
    expect(round(w, "r2m1")).toBeFalsy(); // still waiting for its feeders
  });

  it("starts a rolling match the moment its second feeder is decided", () => {
    const w = setup();
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(60));
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(70));
    expect(round(w, "r2m1")).toBeFalsy();
    w.store.recordGame("Ruth", "r1m2", "hi", "x", at(100));
    w.store.recordGame("Ruth", "r1m2", "hi", "x", at(110));
    expect(round(w, "r2m1")).toMatchObject({ game: 1, startedAt: at(110).toISOString(), closesAt: at(110 + 180).toISOString() });
  });

  it("closes the book on a match once it is decided", () => {
    const w = setup();
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(60));
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(70));
    expect(round(w, "r1m1")).toBeNull();
  });
});

describe("I'm ready", () => {
  it("records who was waiting, once", () => {
    const w = setup();
    expect(w.store.play.markReady("P01", at(30)).ok).toBe(true);
    expect(w.store.play.markReady("P01", at(90)).ok).toBe(true);
    expect(round(w, "r1m1")!.ready).toEqual({ hi: at(30).toISOString() });
    expect(w.store.play.markReady("P08", at(100)).ok).toBe(true);
    expect(round(w, "r1m1")!.ready.lo).toBe(at(100).toISOString());
  });

  it("is for players who have a match to play now", () => {
    const w = setup();
    expect(w.store.play.markReady("P20", at(5))).toEqual({ ok: false, error: "You don’t have a match to play right now." });
    expect(w.store.play.markReady("nobody", at(5)).ok).toBe(false);
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(60));
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(70));
    expect(w.store.play.markReady("P01", at(80)).ok).toBe(false); // advanced, waiting for the next match
    expect(w.store.play.markReady("P08", at(80)).ok).toBe(false); // knocked out
  });
});

describe("the game link", () => {
  it("needs I'm ready first", async () => {
    const w = setup();
    expect(await w.store.play.ensureLink("P01", w.lichess, at(10))).toEqual({ ok: false, error: "Tap I’m ready first." });
  });

  it("is one restricted link per game, shared by both players, with the higher seed as White in game 1", async () => {
    const w = setup();
    const first = await readyAndLink(w, "P01");
    const second = await readyAndLink(w, "P08", at(20));
    expect(second).toBe(first);
    const id = round(w, "r1m1")!.link!.id;
    expect(first).toBe(`https://lichess.org/${id}`);
    w.lichess.simulate(id, "join", at(30));
    expect(await w.lichess.getGame(id)).toMatchObject({ white: "P01", black: "P08" });
  });

  it("makes only one link when both players ask at the same moment", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    w.store.play.markReady("P08", at(10));
    const [a, b] = await Promise.all([
      w.store.play.ensureLink("P01", w.lichess, at(11)),
      w.store.play.ensureLink("P08", w.lichess, at(11)),
    ]);
    expect(a).toEqual(b);
    expect(w.store.play.takeCancels()).toEqual([]);
  });

  it("makes a fresh link when the old one was cancelled before anyone joined", async () => {
    const w = setup();
    const first = await readyAndLink(w, "P01");
    await w.lichess.cancelLink(round(w, "r1m1")!.link!.id);
    const again = await w.store.play.ensureLink("P01", w.lichess, at(40));
    expect(again.ok && again.url).not.toBe(first);
  });

  it("is not made while a claim is waiting for a referee", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    await w.store.play.claimWin("P01", w.lichess, at(200));
    const link = await w.store.play.ensureLink("P01", w.lichess, at(210));
    expect(link.ok).toBe(false);
  });

  it("puts the lower seed first, so Black, in game 2", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    await playOut(w, "r1m1", "black", 300); // P08 beats P01 in game 1
    await readyAndLink(w, "P01", at(310));
    const id = round(w, "r1m1")!.link!.id;
    w.lichess.simulate(id, "join", at(320));
    expect(await w.lichess.getGame(id)).toMatchObject({ white: "P08", black: "P01" });
  });
});

describe("reading the result from Lichess", () => {
  it("does nothing until both players have joined", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    expect(await w.store.play.syncGame("r1m1", w.lichess, at(20))).toEqual({ ok: true, changed: false });
    w.lichess.simulate(round(w, "r1m1")!.link!.id, "join", at(25));
    expect(await w.store.play.syncGame("r1m1", w.lichess, at(30))).toEqual({ ok: true, changed: true });
    expect(round(w, "r1m1")!.joined).toBe(true);
    expect(await w.store.play.syncGame("r1m1", w.lichess, at(35))).toEqual({ ok: true, changed: false });
  });

  it("records a finished game as read from Lichess and starts a 2-minute wait for the next one", async () => {
    const w = setup();
    const url = await readyAndLink(w, "P01");
    const outcome = await playOut(w, "r1m1", "white", 300);
    expect(outcome).toEqual({ ok: true, changed: true });

    const [game] = w.store.tournament.records.r1m1.games;
    expect(game).toEqual({ outcome: "hi", source: "lichess", lichessId: url.split("/").pop(), endedAt: at(300).toISOString() });
    expect(round(w, "r1m1")).toMatchObject({
      game: 2,
      startedAt: at(300).toISOString(),
      closesAt: at(420).toISOString(),
      ready: {},
    });
    expect(round(w, "r1m1")!.link).toBeUndefined();
    expect(w.store.audit.at(-1)).toMatchObject({ actor: "Lichess", action: expect.stringContaining("P01 won") });
  });

  it("maps the colour that won to the seed, using the colours of that game", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    await playOut(w, "r1m1", "white", 300); // game 1: P01 is White and wins
    await readyAndLink(w, "P08", at(310));
    await playOut(w, "r1m1", "black", 600); // game 2: P01 is Black and wins
    expect(w.store.tournament.records.r1m1.games.map((g) => g.outcome)).toEqual(["hi", "hi"]);
    expect(w.store.resolved()!.matches.r1m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "score" });
  });

  it("goes to game 3 when level, and the winner moves on when the match is decided", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    await playOut(w, "r1m1", "white", 300);
    await readyAndLink(w, "P01", at(310));
    await playOut(w, "r1m1", "white", 600); // game 2: White is P08, so P08 wins: 1 all
    expect(round(w, "r1m1")).toMatchObject({ game: 3 });
    await readyAndLink(w, "P01", at(610));
    await playOut(w, "r1m1", "draw", 900);
    expect(round(w, "r1m1")).toMatchObject({ game: 4 }); // a drawn game 3 means two more games
  });

  it("counts an aborted game as not played, and the same game starts again on a fresh link", async () => {
    const w = setup();
    const first = await readyAndLink(w, "P01");
    await w.store.play.markReady("P08", at(12));
    const outcome = await playOut(w, "r1m1", "abort", 100);
    expect(outcome).toEqual({ ok: true, changed: true });

    expect(w.store.tournament.records.r1m1).toBeUndefined(); // no game recorded
    expect(w.store.tournament.play.r1m1.aborts).toBe(1);
    expect(round(w, "r1m1")).toMatchObject({ game: 1, ready: {}, closesAt: at(105 + 120).toISOString() });
    expect(round(w, "r1m1")!.link).toBeUndefined();

    const second = await readyAndLink(w, "P01", at(130));
    expect(second).not.toBe(first);
  });

  it("asks a referee to look after two aborts in one match", async () => {
    const w = setup();
    // Both aborts happen inside the other matches' 3-minute windows, so only this match is on the desk.
    await readyAndLink(w, "P01");
    await playOut(w, "r1m1", "abort", 50);
    expect(w.store.play.desk(at(60)).items).toEqual([]);
    await readyAndLink(w, "P01", at(70));
    await playOut(w, "r1m1", "abort", 100);
    const { items } = w.store.play.desk(at(110));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ matchId: "r1m1", aborts: 2, reasons: ["Lichess aborted 2 games of this match."] });
  });

  it("hands a Lichess status it does not understand to a referee", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    const id = round(w, "r1m1")!.link!.id;
    class Odd extends MockLichess {
      override async getGame(): Promise<LichessGame | null> {
        return { id, status: "unknownFinish", winner: null, white: "P01", black: "P08", endedAt: at(200) };
      }
    }
    expect(await w.store.play.syncGame("r1m1", new Odd(), at(210))).toEqual({ ok: true, changed: true });
    expect(w.store.tournament.records.r1m1).toBeUndefined();
    expect(w.store.play.desk(at(220)).items[0].refereeNote).toMatch(/unknownFinish/);
  });

  it("reports Lichess being unreachable instead of throwing", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    class Down extends MockLichess {
      override async getGame(): Promise<LichessGame | null> {
        throw new Error("network down");
      }
    }
    expect(await w.store.play.syncGame("r1m1", new Down(), at(20))).toEqual({ ok: false, error: "Could not reach Lichess. Try again in a moment." });
  });
});

describe("claiming a win", () => {
  it("is refused until the waiting time is over, and until the claimant tapped ready", async () => {
    const w = setup();
    expect(await w.store.play.claimWin("P01", w.lichess, at(200))).toMatchObject({ ok: false, error: expect.stringContaining("ready first") });
    w.store.play.markReady("P01", at(10));
    expect(await w.store.play.claimWin("P01", w.lichess, at(100))).toEqual({ ok: false, error: "The waiting time is not over yet." });
    expect(await w.store.play.claimWin("P01", w.lichess, at(181))).toEqual({ ok: true });
  });

  it("is refused if the opponent appeared, by tapping ready or by joining the game", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    w.store.play.markReady("P08", at(20));
    expect(await w.store.play.claimWin("P01", w.lichess, at(200))).toMatchObject({ ok: false, error: expect.stringContaining("opponent is ready") });

    const x = setup();
    await readyAndLink(x, "P01");
    x.lichess.simulate(round(x, "r1m1")!.link!.id, "join", at(150));
    expect(await x.store.play.claimWin("P01", x.lichess, at(200))).toMatchObject({ ok: false, error: expect.stringContaining("joined the game") });
  });

  it("goes to a referee, who gives the win to the claimant and closes the link", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    const id = round(w, "r1m1")!.link!.id;
    expect(await w.store.play.claimWin("P01", w.lichess, at(200))).toEqual({ ok: true });
    expect(await w.store.play.claimWin("P01", w.lichess, at(205))).toEqual({ ok: true }); // a second tap changes nothing
    expect(w.store.play.desk(at(210)).items[0]).toMatchObject({ matchId: "r1m1", claim: { by: "hi", byName: "P01" } });

    expect(w.store.play.confirmClaim("Dan", "r1m1", at(220)).ok).toBe(false); // the desk cannot decide results
    expect(w.store.play.confirmClaim("Ruth", "r1m1", at(220))).toEqual({ ok: true });
    expect(w.store.resolved()!.matches.r1m1).toMatchObject({ status: "decided", winner: 1, decidedBy: "no_show" });
    expect(w.store.play.takeCancels()).toEqual([id]); // nobody can start the game on that link now
    expect(w.store.audit.at(-1)).toMatchObject({ actor: "Ruth", reason: expect.stringContaining("did not appear") });
  });

  it("can be turned down, which gives the players two more minutes", async () => {
    const w = setup();
    w.store.play.markReady("P01", at(10));
    await w.store.play.claimWin("P01", w.lichess, at(200));
    expect(w.store.play.rejectClaim("Dan", "r1m1", at(230)).ok).toBe(false);
    expect(w.store.play.rejectClaim("Ruth", "r1m1", at(230))).toEqual({ ok: true });
    expect(round(w, "r1m1")).toMatchObject({ closesAt: at(350).toISOString() });
    expect(round(w, "r1m1")!.claim).toBeUndefined();
    expect(w.store.resolved()!.matches.r1m1.status).toBe("ready");
  });

  it("can be settled by a referee when nobody claimed, including when neither player came", () => {
    const w = setup();
    expect(w.store.play.settleNoShow("Ruth", "r1m1", "none", at(300))).toEqual({ ok: true });
    expect(w.store.resolved()!.matches.r1m1).toMatchObject({ status: "decided", winner: null, decidedBy: "double_no_show" });
    expect(w.store.play.settleNoShow("Ruth", "r1m2", "lo", at(300))).toEqual({ ok: true });
    expect(w.store.resolved()!.matches.r1m2).toMatchObject({ winner: 5, decidedBy: "no_show" }); // P05 turned up, whatever the seed
    // The waiting opponent in the next round advances by walkover.
    expect(w.store.resolved()!.matches.r2m1).toMatchObject({ status: "decided", winner: 5, decidedBy: "walkover" });
    expect(w.store.play.settleNoShow("Dan", "r1m3", "none", at(300)).ok).toBe(false);
  });
});

describe("problems", () => {
  it("are recorded for the referee, and flagged late after five minutes", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    expect(w.store.play.reportProblem("P01", "My opponent’s game froze", at(30))).toEqual({ ok: true });
    await playOut(w, "r1m1", "white", 300);
    expect(w.store.play.reportProblem("P08", "The result looks wrong", at(300 + 120)).ok).toBe(true);
    expect(w.store.play.reportProblem("P08", "Still wrong", at(300 + 400)).ok).toBe(true);

    const { problems } = w.store.play.desk(at(900));
    expect(problems.map((p) => [p.by, p.late])).toEqual([["P08", true], ["P08", false], ["P01", false]]);
    expect(problems[0]).toMatchObject({ matchId: "r1m1", title: "Quarterfinal 1", text: "Still wrong" });
  });

  it("can be reported by a player who has just been knocked out", () => {
    const w = setup();
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(60));
    w.store.recordGame("Ruth", "r1m1", "hi", "x", at(70));
    expect(w.store.play.reportProblem("P08", "I think I was disconnected", at(80)).ok).toBe(true);
    expect(w.store.play.desk(at(90)).problems[0]).toMatchObject({ by: "P08", game: 2 });
  });

  it("carries no game number when the match ended without a game being played", () => {
    const w = setup();
    w.store.recordNoShow("Ruth", "r1m1", { hi: true, lo: false }, "P08 did not appear", at(60));
    expect(w.store.play.reportProblem("P08", "My ready button did not respond", at(70)).ok).toBe(true);
    expect(w.store.play.desk(at(80)).problems[0]).toMatchObject({ by: "P08", game: null });
  });

  it("need some words, not too many, and not endless", () => {
    const w = setup();
    expect(w.store.play.reportProblem("P01", "   ", at(5))).toEqual({ ok: false, error: "Say what went wrong." });
    expect(w.store.play.reportProblem("P01", "x".repeat(501), at(5)).ok).toBe(false);
    for (let i = 0; i < 5; i++) expect(w.store.play.reportProblem("P01", `problem ${i}`, at(5 + i)).ok).toBe(true);
    expect(w.store.play.reportProblem("P01", "one more", at(20)).ok).toBe(false);
    expect(w.store.play.reportProblem("P20", "not playing", at(5)).ok).toBe(false);
  });
});

describe("when a referee changes a match", () => {
  it("closes the link and starts the next waiting time", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    const id = round(w, "r1m1")!.link!.id;
    w.store.recordGame("Ruth", "r1m1", "hi", "Lichess was down", at(100));
    expect(w.store.play.takeCancels()).toEqual([id]);
    expect(round(w, "r1m1")).toMatchObject({ game: 2, startedAt: at(100).toISOString() });
    expect(w.store.play.takeCancels()).toEqual([]); // each link is handed back once
  });

  it("forgets everything, and closes every open link, when the bracket is reset", async () => {
    const w = setup();
    await readyAndLink(w, "P01");
    await readyAndLink(w, "P04");
    expect(w.store.resetBracket("Joel", "Wrong cut-off", at(50)).ok).toBe(true);
    expect(w.store.play.takeCancels()).toHaveLength(2);
    expect(w.store.tournament.play).toEqual({});
  });
});
