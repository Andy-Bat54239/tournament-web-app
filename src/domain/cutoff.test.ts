import { describe, expect, it } from "vitest";
import { cutNotes, cutOff, nameList, type Ranked } from "./cutoff";

/** Standings from points alone, in the order given. Names are A, B, C and so on. */
function table(...pointsInOrder: number[]): Ranked[] {
  return pointsInOrder.map((points, i) => ({ rank: i + 1, username: String.fromCharCode(65 + i), points }));
}

const fates = (view: ReturnType<typeof cutOff>) => view.rows.map((r) => r.fate);

describe("the order", () => {
  it("keeps Lichess's order and never ranks anyone itself", () => {
    // Lichess put B above A on equal points: that is its tiebreak, and it stands.
    const view = cutOff(
      [
        { rank: 2, username: "A", points: 3 },
        { rank: 1, username: "B", points: 3 },
      ],
      1,
      { roundsLeft: 0 },
    );
    expect(view.rows.map((r) => r.username)).toEqual(["B", "A"]);
    expect(view.rows.map((r) => r.inside)).toEqual([true, false]);
  });

  it("does not change the list it is given", () => {
    const given = [...table(3, 2)].reverse();
    cutOff(given, 1, { roundsLeft: 0 });
    expect(given.map((r) => r.username)).toEqual(["B", "A"]);
  });
});

describe("a finished Swiss", () => {
  // Four places. 5, 4 and 4 are clear. Two players share 3 points across the line. The last has 2.
  const view = cutOff(table(5, 4, 4, 3, 3, 2), 4, { roundsLeft: 0 });

  it("puts the line after the last place that plays on", () => {
    expect(view.rows.map((r) => r.inside)).toEqual([true, true, true, true, false, false]);
    expect(view.cutPoints).toBe(3);
    expect(view.finished).toBe(true);
  });

  it("marks only the players level at the line as the bubble", () => {
    expect(fates(view)).toEqual(["through", "through", "through", "bubble", "bubble", "out"]);
    expect(view.rows.map((r) => r.level)).toEqual([false, false, false, true, true, false]);
  });

  it("has no bubble when the last place inside is on its own", () => {
    const clear = cutOff(table(5, 4, 3, 2, 1), 3, { roundsLeft: 0 });
    expect(fates(clear)).toEqual(["through", "through", "through", "out", "out"]);
    expect(clear.rows.some((r) => r.level)).toBe(false);
  });

  it("counts a player level with the line as undecided, even when they are inside", () => {
    // Three players want two places.
    const crowded = cutOff(table(5, 3, 3, 3), 2, { roundsLeft: 0 });
    expect(fates(crowded)).toEqual(["through", "bubble", "bubble", "bubble"]);
  });

  it("does not treat a tie that is wholly inside as a level line", () => {
    const inside = cutOff(table(4, 4, 2, 1), 3, { roundsLeft: 0 });
    expect(fates(inside)).toEqual(["through", "through", "through", "out"]);
    expect(inside.rows.some((r) => r.level)).toBe(false);
  });
});

describe("a Swiss still under way", () => {
  it("decides nobody after the first round, and calls the players level with the line or near it the bubble", () => {
    // 12 players, six won. Four places, so the line runs through the six winners. Four rounds to go.
    const view = cutOff(table(1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0), 4, { roundsLeft: 4 });
    expect(fates(view)).toEqual([...Array(7).fill("bubble"), ...Array(5).fill("open")]);
  });

  it("calls everyone level with the line the bubble, however far from it they are listed", () => {
    // Ten players are all level on 2 points, five places. The line runs through the middle of them.
    const view = cutOff(table(3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0), 5, { roundsLeft: 3 });
    expect(view.rows.filter((r) => r.level)).toHaveLength(10);
    expect(view.rows.slice(1, 11).every((r) => r.fate === "bubble")).toBe(true);
  });

  it("clears a leader nobody can catch, and a player nobody below can fall behind", () => {
    // Two places, one round left. A leads on 4. B, C: 2. D: 0.
    const view = cutOff(table(4, 2, 2, 0), 2, { roundsLeft: 1 });
    // A: the others reach 3, 3 and 1 at most, all behind 4 even with a tie against them.
    expect(view.rows[0].fate).toBe("through");
    // D: at most 1, and two players are already on 2.
    expect(view.rows[3].fate).toBe("out");
    // B and C are level for the second place.
    expect(view.rows[1].fate).toBe("bubble");
    expect(view.rows[2].fate).toBe("bubble");
  });

  it("is out only when enough players are already ahead of the best a player can reach", () => {
    // Two places. A and B are on 3. C and D are on 1, so they can reach 2 with one round left, but not 3.
    expect(fates(cutOff(table(3, 3, 1, 1), 2, { roundsLeft: 1 })).slice(2)).toEqual(["out", "out"]);
    // With two rounds left they can reach 3, and tie.
    expect(fates(cutOff(table(3, 3, 1, 1), 2, { roundsLeft: 2 })).slice(2)).toEqual(["bubble", "bubble"]);
    // One player ahead is not enough to put a player out of two places.
    expect(fates(cutOff(table(4, 2, 2, 1), 2, { roundsLeft: 1 }))[3]).toBe("bubble");
  });

  it("counts ties against a player when clearing them", () => {
    // Two places, A on 2, B on 2, C on 1, one round left. C can reach 2 and tie, so A is not yet through.
    const view = cutOff(table(2, 2, 1), 2, { roundsLeft: 1 });
    expect(view.rows[0].fate).not.toBe("through");
    // After the last round, with C on 1, A is through.
    expect(cutOff(table(2, 2, 1), 2, { roundsLeft: 0 }).rows[0].fate).toBe("through");
  });

  it("is more careful, never less, when told more rounds are left", () => {
    const standings = table(5, 4, 4, 3, 3, 2, 1, 0);
    const known = (roundsLeft: number) => cutOff(standings, 4, { roundsLeft }).rows.filter((r) => r.fate === "through" || r.fate === "out").length;
    expect(known(0)).toBeGreaterThanOrEqual(known(1));
    expect(known(1)).toBeGreaterThanOrEqual(known(2));
    expect(known(2)).toBeGreaterThanOrEqual(known(5));
  });

  it("gives span as the number of places either side of the line", () => {
    // Nobody level, and so many rounds left that nobody is decided.
    const spread = table(...Array.from({ length: 12 }, (_, i) => 12 - i));
    const view = cutOff(spread, 6, { roundsLeft: 12, span: 2 });
    expect(view.rows.filter((r) => r.fate === "bubble").map((r) => r.username)).toEqual(["E", "F", "G", "H"]);
  });
});

describe("what it claims is true however the rest of the Swiss goes", () => {
  /** A small deterministic random number generator, so a failure can be repeated. */
  function random(seed: number) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
  }

  it("never puts a player through who can still miss out, or out who can still make it", () => {
    const next = random(7);
    for (let trial = 0; trial < 300; trial++) {
      const players = 4 + Math.floor(next() * 9);
      const places = 1 + Math.floor(next() * (players - 1));
      const roundsLeft = Math.floor(next() * 4);
      const start = Array.from({ length: players }, () => Math.floor(next() * 9) / 2);
      const standings: Ranked[] = start
        .map((points, i) => ({ username: `P${i}`, points }))
        .sort((a, b) => b.points - a.points)
        .map((row, i) => ({ ...row, rank: i + 1 }));
      const view = cutOff(standings, places, { roundsLeft });

      for (let future = 0; future < 60; future++) {
        // Each player scores up to a point a round, in half points, and Lichess's tiebreak is anyone's guess.
        const finals = standings.map((row) => ({
          username: row.username,
          points: row.points + Math.floor(next() * (2 * roundsLeft + 1)) / 2,
          luck: next(),
        }));
        finals.sort((a, b) => b.points - a.points || b.luck - a.luck);
        const made = new Set(finals.slice(0, places).map((f) => f.username));
        for (const row of view.rows) {
          if (row.fate === "through") expect(made.has(row.username), `${row.username} was cleared but missed out`).toBe(true);
          if (row.fate === "out") expect(made.has(row.username), `${row.username} was put out but made it`).toBe(false);
        }
      }
    }
  });
});

describe("when everyone fits", () => {
  it("draws no line", () => {
    const view = cutOff(table(3, 2), 16, { roundsLeft: 0 });
    expect(view.cutPoints).toBeNull();
    expect(view.places).toBe(16);
    expect(fates(view)).toEqual(["through", "through"]);
    expect(view.rows.every((r) => r.inside)).toBe(true);
  });

  it("decides nobody before the Swiss is over", () => {
    expect(fates(cutOff(table(3, 2), 16, { roundsLeft: 2 }))).toEqual(["open", "open"]);
  });

  it("copes with no players, and with no places asked for", () => {
    expect(cutOff([], 16, { roundsLeft: 0 }).rows).toEqual([]);
    expect(fates(cutOff(table(2, 1), 0, { roundsLeft: 0 }))).toEqual(["through", "out"]);
  });
});

describe("the sentences", () => {
  it("name who missed the cut and who made it on the tiebreak once the Swiss is over", () => {
    const notes = cutNotes(cutOff(table(5, 4, 3, 3, 3, 1), 3, { roundsLeft: 0 }));
    expect(notes).toEqual([
      "The Swiss is over. The top 3 play on.",
      "D and E missed the cut on Lichess’s tiebreak.",
      "C made it on Lichess’s tiebreak.",
    ]);
  });

  it("say nothing about the tiebreak when nobody was level at the line", () => {
    expect(cutNotes(cutOff(table(5, 4, 3, 2), 3, { roundsLeft: 0 }))).toEqual(["The Swiss is over. The top 3 play on."]);
  });

  it("give the line and the bubble while the Swiss is under way", () => {
    const notes = cutNotes(cutOff(table(...Array.from({ length: 10 }, (_, i) => 10 - i)), 5, { roundsLeft: 10 }));
    expect(notes[0]).toBe("The top 5 play on. The line is at 6 points right now.");
    expect(notes[1]).toBe("On the bubble: C, D, E, F, G and H.");
  });

  it("say '1 point' for one point", () => {
    expect(cutNotes(cutOff(table(2, 1, 0), 2, { roundsLeft: 3 }))[0]).toBe("The top 2 play on. The line is at 1 point right now.");
  });

  it("say so when nobody is left on the bubble", () => {
    expect(cutNotes(cutOff(table(9, 9, 0, 0), 2, { roundsLeft: 1 }))[1]).toBe("Nobody is on the bubble: everyone is through or out.");
  });

  it("explain when there is no line", () => {
    expect(cutNotes(cutOff(table(3, 2), 16, { roundsLeft: 0 }))).toEqual(["Everyone plays on: only 2 players for 16 places."]);
    expect(cutNotes(cutOff(table(3, 2), 16, { roundsLeft: 2 }))).toEqual(["Nobody is cut so far: 2 players for 16 places."]);
  });
});

describe("nameList", () => {
  it("reads like a sentence", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Kevin"])).toBe("Kevin");
    expect(nameList(["Kevin", "Joan"])).toBe("Kevin and Joan");
    expect(nameList(["Kevin", "Joan", "Ivan"])).toBe("Kevin, Joan and Ivan");
  });

  it("stops at a limit", () => {
    expect(nameList(["A", "B", "C", "D", "E"], 3)).toBe("A, B, C and 2 more");
  });
});
