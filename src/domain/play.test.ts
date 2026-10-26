import { describe, expect, it } from "vitest";
import {
  claimProblem,
  classifyGame,
  formatCountdown,
  isLate,
  outcomeOf,
  secondsLeft,
  windowFor,
  FIRST_GAME_WINDOW,
  NEXT_GAME_WINDOW,
} from "./play";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 1, 11, 0, seconds));

describe("windowFor", () => {
  it("gives 3 minutes for game 1 and 2 minutes after that", () => {
    expect(windowFor(1)).toBe(FIRST_GAME_WINDOW);
    expect(FIRST_GAME_WINDOW).toBe(180_000);
    for (const game of [2, 3, 4, 5]) expect(windowFor(game)).toBe(NEXT_GAME_WINDOW);
    expect(NEXT_GAME_WINDOW).toBe(120_000);
  });
});

describe("classifyGame", () => {
  it("treats a game in play as ongoing", () => {
    expect(classifyGame("created")).toEqual({ kind: "ongoing" });
    expect(classifyGame("started")).toEqual({ kind: "ongoing" });
  });

  it("counts an abort as not played, however it happened", () => {
    expect(classifyGame("aborted")).toEqual({ kind: "not_played" });
    expect(classifyGame("noStart")).toEqual({ kind: "not_played" });
  });

  it("reads wins with the colour that won", () => {
    for (const status of ["mate", "resign", "timeout", "outoftime"]) {
      expect(classifyGame(status, "black")).toEqual({ kind: "result", winner: "black" });
    }
    expect(classifyGame("mate", "white")).toEqual({ kind: "result", winner: "white" });
  });

  it("reads draws as a result with no winner", () => {
    for (const status of ["draw", "stalemate", "insufficientMaterialClaim"]) {
      expect(classifyGame(status)).toEqual({ kind: "result", winner: null });
    }
  });

  it("sends anything it does not understand to a referee", () => {
    expect(classifyGame("unknownFinish").kind).toBe("needs_referee");
    expect(classifyGame("cheat", "white").kind).toBe("needs_referee");
    expect(classifyGame("mate").kind).toBe("needs_referee"); // a win with no winner is not trusted
    expect(classifyGame("somethingNew")).toMatchObject({ kind: "needs_referee", reason: expect.stringContaining("somethingNew") });
  });
});

describe("outcomeOf", () => {
  it("maps the colour that won to the seed, given who had White", () => {
    // Game 1: the higher seed has White.
    expect(outcomeOf(1, "white")).toBe("hi");
    expect(outcomeOf(1, "black")).toBe("lo");
    // Game 2: colours swap.
    expect(outcomeOf(2, "white")).toBe("lo");
    expect(outcomeOf(2, "black")).toBe("hi");
    expect(outcomeOf(3, "white")).toBe("hi");
    expect(outcomeOf(4, "white")).toBe("lo");
    expect(outcomeOf(5, "black")).toBe("lo");
  });

  it("is a draw whatever the colours", () => {
    for (const game of [1, 2, 3, 4, 5]) expect(outcomeOf(game, null)).toBe("draw");
  });
});

describe("countdown", () => {
  it("counts down to zero and stays there", () => {
    expect(secondsLeft(at(0), at(180))).toBe(180);
    expect(secondsLeft(at(10.4), at(180))).toBe(170);
    expect(secondsLeft(at(180), at(180))).toBe(0);
    expect(secondsLeft(at(500), at(180))).toBe(0);
  });

  it("formats minutes and seconds", () => {
    expect(formatCountdown(180)).toBe("3:00");
    expect(formatCountdown(154)).toBe("2:34");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });
});

describe("claimProblem", () => {
  const base = { now: at(200), closesAt: at(180), claimantReady: true, opponentReady: false, gameStarted: false };

  it("lets a waiting player claim once the window is over and the opponent never appeared", () => {
    expect(claimProblem(base)).toBeNull();
  });

  it("makes the claimant tap ready first", () => {
    expect(claimProblem({ ...base, claimantReady: false })).toMatch(/ready first/);
  });

  it("makes the claimant wait out the window", () => {
    expect(claimProblem({ ...base, now: at(100) })).toMatch(/not over/);
    expect(claimProblem({ ...base, now: at(179.9) })).toMatch(/not over/);
  });

  it("refuses when the opponent appeared, by tapping ready or by joining the game", () => {
    expect(claimProblem({ ...base, opponentReady: true })).toMatch(/opponent is ready/);
    expect(claimProblem({ ...base, gameStarted: true })).toMatch(/joined the game/);
  });
});

describe("isLate", () => {
  it("flags a problem reported more than five minutes after the game ended", () => {
    expect(isLate(at(0), at(299))).toBe(false);
    expect(isLate(at(0), at(301))).toBe(true);
  });

  it("is never late when there is no finished game to measure from", () => {
    expect(isLate(null, at(9999))).toBe(false);
  });
});
