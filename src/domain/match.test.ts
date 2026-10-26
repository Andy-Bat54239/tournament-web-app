import { describe, expect, it } from "vitest";
import { scoreMatch, whiteInGame, nextGameNote, type Game, type GameOutcome } from "./match";

const games = (...outcomes: GameOutcome[]): Game[] =>
  outcomes.map((outcome) => ({ outcome, source: "lichess" }));

describe("whiteInGame", () => {
  it("gives the higher seed White first, then alternates", () => {
    expect([1, 2, 3, 4, 5].map(whiteInGame)).toEqual(["hi", "lo", "hi", "lo", "hi"]);
  });
});

describe("scoreMatch", () => {
  it("starts with game 1", () => {
    const s = scoreMatch([]);
    expect(s).toMatchObject({ played: 0, winner: null, next: { game: 1, white: "hi" } });
  });

  it("is decided after two games when one player leads", () => {
    const s = scoreMatch(games("hi", "hi"));
    expect(s).toMatchObject({ hi: 2, lo: 0, winner: "hi", decidedBy: "score", next: null });
  });

  it("is decided after two games on 1.5 to 0.5", () => {
    expect(scoreMatch(games("lo", "draw")).winner).toBe("lo");
  });

  it("goes to game 3 when level after two, whichever way it got level", () => {
    for (const level of [games("hi", "lo"), games("lo", "hi"), games("draw", "draw")]) {
      const s = scoreMatch(level);
      expect(s.winner).toBeNull();
      expect(s.next).toEqual({ game: 3, white: "hi", phase: "decider" });
    }
  });

  it("is decided by game 3 unless it is drawn", () => {
    expect(scoreMatch(games("hi", "lo", "lo"))).toMatchObject({ winner: "lo", decidedBy: "score" });
  });

  it("plays games 4 and 5 when game 3 is drawn", () => {
    const afterThree = scoreMatch(games("hi", "lo", "draw"));
    expect(afterThree.winner).toBeNull();
    expect(afterThree.next).toEqual({ game: 4, white: "lo", phase: "tiebreak" });
  });

  it("does not decide after game 4, even with a lead", () => {
    const s = scoreMatch(games("lo", "hi", "draw", "hi"));
    expect(s.winner).toBeNull();
    expect(s.next).toEqual({ game: 5, white: "hi", phase: "tiebreak" });
  });

  it("is decided by score after game 5", () => {
    expect(scoreMatch(games("lo", "hi", "draw", "hi", "hi"))).toMatchObject({
      winner: "hi",
      decidedBy: "score",
    });
    expect(scoreMatch(games("hi", "lo", "draw", "lo", "lo"))).toMatchObject({
      winner: "lo",
      decidedBy: "score",
    });
  });

  it("gives the higher seed the win if still level after game 5", () => {
    const s = scoreMatch(games("lo", "hi", "draw", "hi", "lo"));
    expect(s).toMatchObject({ hi: 2.5, lo: 2.5, winner: "hi", decidedBy: "higher_seed", next: null });
    expect(scoreMatch(games("hi", "lo", "draw", "draw", "draw")).winner).toBe("hi");
  });

  it("refuses games after the match is decided", () => {
    expect(() => scoreMatch(games("hi", "hi", "lo"))).toThrow(/decided/);
  });

  it("refuses more than five games", () => {
    expect(() => scoreMatch(games("draw", "draw", "draw", "draw", "draw", "draw"))).toThrow();
  });
});

describe("nextGameNote", () => {
  it("explains tiebreak games in plain words", () => {
    expect(nextGameNote(scoreMatch(games("hi", "lo")))).toBe("Tied after two games, so game 3 decides.");
    expect(nextGameNote(scoreMatch(games("hi", "lo", "draw")))).toBe("Still level, so two more games.");
    expect(nextGameNote(scoreMatch(games("hi", "lo", "draw", "hi")))).toMatch(/higher seed advances/);
    expect(nextGameNote(scoreMatch(games("hi")))).toBe("");
    expect(nextGameNote(scoreMatch(games("hi", "hi")))).toBe("");
  });
});
