import { describe, expect, it } from "vitest";
import { activeRound, countStages, points, roundUpdateText, type BoardMatch, type BoardRound, type RoundBoard, type BoardStage } from "./round-board";

const match = (id: string, hi: string, lo: string, stage: BoardStage): BoardMatch => ({ id, title: id, hi, lo, stage, note: "" });
const round = (n: number, title: string, matches: BoardMatch[]): BoardRound => ({ round: n, title, matches });
const board = (rounds: BoardRound[], over: Partial<RoundBoard> = {}): RoundBoard => ({ rounds, held: false, champion: null, ...over });

describe("points", () => {
  it("writes halves the way chess does", () => {
    expect([0, 0.5, 1, 1.5, 2, 2.5].map(points)).toEqual(["0", "½", "1", "1½", "2", "2½"]);
  });
});

describe("countStages", () => {
  it("counts matches in each stage", () => {
    const counts = countStages([match("a", "A", "B", "ready"), match("b", "C", "D", "ready"), match("c", "E", "F", "flagged")]);
    expect(counts).toEqual({ waiting: 0, held: 0, ready: 2, playing: 0, flagged: 1, decided: 0 });
  });
});

describe("activeRound", () => {
  it("is the first round with a match still to be played", () => {
    const r1 = round(1, "Quarterfinals", [match("a", "A", "B", "decided"), match("b", "C", "D", "decided")]);
    const r2 = round(2, "Semifinals", [match("c", "A", "C", "playing")]);
    expect(activeRound(board([r1, r2]))?.title).toBe("Semifinals");
    expect(activeRound(board([r1]))).toBeNull();
  });
});

describe("the round update for the community chat", () => {
  const quarter = (stages: BoardStage[]) =>
    round(1, "Quarterfinals", [
      match("q1", "Mercy", "Kevin", stages[0]),
      match("q2", "Ivan", "Patience", stages[1]),
      match("q3", "Grace", "Ronald", stages[2]),
      match("q4", "Brian", "Sarah", stages[3]),
    ]);

  it("says who is still to start, and how many are finished", () => {
    const text = roundUpdateText(board([quarter(["decided", "ready", "playing", "ready"])]));
    expect(text).toBe(
      "Quarterfinals are live. 1 of 4 matches finished. Still waiting to start: Ivan v Patience, Brian v Sarah. Open the app to play your match.",
    );
  });

  it("counts a flagged match as still waiting to start, because nobody is playing it", () => {
    expect(roundUpdateText(board([quarter(["flagged", "playing", "playing", "playing"])]))).toContain("Still waiting to start: Mercy v Kevin.");
  });

  it("says every match is under way when nobody is waiting", () => {
    const text = roundUpdateText(board([quarter(["playing", "playing", "decided", "decided"])]));
    expect(text).toContain("2 of 4 matches finished.");
    expect(text).toContain("Every match is under way.");
  });

  it("says a round starts soon while the knockout is on hold", () => {
    const text = roundUpdateText(board([quarter(["held", "held", "held", "held"])], { held: true }));
    expect(text).toBe("The Quarterfinals start soon: Mercy v Kevin, Ivan v Patience, Grace v Ronald, Brian v Sarah. Open the app to see your match.");
    const final = round(3, "Final", [match("f", "Mercy", "Ivan", "held")]);
    expect(roundUpdateText(board([final], { held: true }))).toContain("The Final starts soon: Mercy v Ivan.");
  });

  it("names the final as one match, and the champion at the end", () => {
    const final = round(3, "Final", [match("f", "Mercy", "Ivan", "ready")]);
    expect(roundUpdateText(board([final]))).toBe("Final is live. Still waiting to start: Mercy v Ivan. Open the app to play your match.");
    const over = round(3, "Final", [match("f", "Mercy", "Ivan", "decided")]);
    expect(roundUpdateText(board([over], { champion: "Mercy" }))).toContain("Mercy is the champion (provisional");
  });

  it("does not list a long field out in full", () => {
    const many = round(1, "Round of 32", Array.from({ length: 10 }, (_, i) => match(`m${i}`, `A${i}`, `B${i}`, "ready")));
    const text = roundUpdateText(board([many]));
    expect(text).toContain("A0 v B0, A1 v B1, A2 v B2, A3 v B3, A4 v B4, A5 v B5 and 4 more");
  });

  it("has something sensible to say before anything is open, and after everything is decided", () => {
    expect(roundUpdateText(board([]))).toContain("bracket is built");
  });
});
