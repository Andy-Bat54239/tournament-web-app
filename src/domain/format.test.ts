import { describe, expect, it } from "vitest";
import { planFormat, seedByRating } from "./format";

describe("planFormat", () => {
  it("cannot run with fewer than two players", () => {
    expect(planFormat(0)).toBeNull();
    expect(planFormat(1)).toBeNull();
  });

  it("runs up to 16 players as a straight knockout", () => {
    expect(planFormat(8)).toEqual({ kind: "knockout_only", swissRounds: 0, qualifiers: 8, knockoutRounds: 3 });
    expect(planFormat(16)).toMatchObject({ kind: "knockout_only", qualifiers: 16, knockoutRounds: 4 });
    expect(planFormat(11)).toMatchObject({ qualifiers: 11, knockoutRounds: 4 }); // byes fill the bracket
  });

  it("takes the top 16 from a 5-round Swiss for 24 to 32 players", () => {
    for (const n of [17, 24, 32]) {
      expect(planFormat(n)).toEqual({ kind: "swiss_knockout", swissRounds: 5, qualifiers: 16, knockoutRounds: 4 });
    }
  });

  it("takes the top 32 for larger fields, with 6 Swiss rounds at 64 (assumed)", () => {
    for (const n of [33, 41, 64]) {
      expect(planFormat(n)).toEqual({ kind: "swiss_knockout", swissRounds: 6, qualifiers: 32, knockoutRounds: 5 });
    }
  });

  it("enforces the cap of 64", () => {
    expect(() => planFormat(65)).toThrow();
  });
});

describe("seedByRating", () => {
  it("puts the highest rating first, new players last, then sign-up order", () => {
    const players = [
      { username: "New", rating: null, joinedAt: "2026-10-26T10:00:00Z" },
      { username: "Low", rating: 1200, joinedAt: "2026-10-26T10:01:00Z" },
      { username: "TieLate", rating: 1500, joinedAt: "2026-10-26T10:03:00Z" },
      { username: "TieEarly", rating: 1500, joinedAt: "2026-10-26T10:02:00Z" },
      { username: "Top", rating: 1800, joinedAt: "2026-10-26T10:04:00Z" },
    ];
    expect(seedByRating(players).map((p) => p.username)).toEqual(["Top", "TieEarly", "TieLate", "Low", "New"]);
    expect(players[0].username).toBe("New"); // input untouched
  });
});
