import { describe, expect, it } from "vitest";
import { bracketSize, buildBracket, roundTitle, seedOrder } from "./bracket";

describe("bracketSize", () => {
  it("rounds up to the next power of two", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(16)).toBe(16);
    expect(bracketSize(17)).toBe(32);
  });

  it("needs at least two qualifiers", () => {
    expect(() => bracketSize(1)).toThrow();
    expect(() => bracketSize(2.5)).toThrow();
  });
});

describe("seedOrder", () => {
  it("matches the brief for 16 players", () => {
    // Top half 1v16, 8v9, 4v13, 5v12; bottom half 2v15, 7v10, 3v14, 6v11.
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it("matches the prototype for 8 players", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("pairs every first-round match so the seeds add up to size + 1", () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const order = seedOrder(size);
      for (let i = 0; i < size; i += 2) expect(order[i] + order[i + 1]).toBe(size + 1);
      expect(new Set(order).size).toBe(size);
    }
  });

  it("keeps the top seeds apart until late", () => {
    const meetRound = (size: number, a: number, b: number) => {
      const order = seedOrder(size);
      const [pa, pb] = [order.indexOf(a), order.indexOf(b)];
      let round = 1;
      while (Math.floor(pa / 2 ** round) !== Math.floor(pb / 2 ** round)) round++;
      return round;
    };
    expect(meetRound(32, 1, 2)).toBe(5); // opposite halves: only in the final
    expect(meetRound(32, 1, 3)).toBe(5);
    expect(meetRound(32, 1, 4)).toBe(4); // same half, different quarters: semifinal at the earliest
    expect(meetRound(32, 2, 3)).toBe(4);
    expect(meetRound(16, 1, 16)).toBe(1);
  });

  it("rejects sizes that are not a power of two", () => {
    expect(() => seedOrder(6)).toThrow();
    expect(() => seedOrder(1)).toThrow();
  });
});

describe("buildBracket", () => {
  it("builds a 16-player bracket in four rounds", () => {
    const b = buildBracket(16);
    expect(b.size).toBe(16);
    expect(b.rounds.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    expect(b.rounds[0][0]).toMatchObject({
      id: "r1m1",
      a: { kind: "seed", seed: 1 },
      b: { kind: "seed", seed: 16 },
    });
    expect(b.rounds[0][1]).toMatchObject({ a: { seed: 8 }, b: { seed: 9 } });
    expect(b.rounds[1][0]).toMatchObject({
      a: { kind: "winner", from: "r1m1" },
      b: { kind: "winner", from: "r1m2" },
    });
    expect(b.finalId).toBe("r4m1");
  });

  it("names matches like the prototype", () => {
    const b = buildBracket(16);
    expect(b.rounds[0][2].title).toBe("Round of 16, match 3");
    expect(b.rounds[1][3].title).toBe("Quarterfinal 4");
    expect(b.rounds[2][1].title).toBe("Semifinal 2");
    expect(b.rounds[3][0].title).toBe("Final");
  });

  it("gives byes to the top seeds when there are too few qualifiers", () => {
    const b = buildBracket(5);
    expect(b.size).toBe(8);
    expect(b.rounds[0].map((m) => [m.a, m.b])).toEqual([
      [{ kind: "seed", seed: 1 }, { kind: "bye" }],
      [{ kind: "seed", seed: 4 }, { kind: "seed", seed: 5 }],
      [{ kind: "seed", seed: 2 }, { kind: "bye" }],
      [{ kind: "seed", seed: 3 }, { kind: "bye" }],
    ]);
  });

  it("handles a two-player final", () => {
    const b = buildBracket(2);
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0][0].title).toBe("Final");
  });
});

describe("roundTitle", () => {
  it("names rounds from the players left", () => {
    expect(roundTitle(32, 1)).toBe("Round of 32");
    expect(roundTitle(32, 2)).toBe("Round of 16");
    expect(roundTitle(32, 3)).toBe("Quarterfinals");
    expect(roundTitle(32, 4)).toBe("Semifinals");
    expect(roundTitle(32, 5)).toBe("Final");
  });
});
