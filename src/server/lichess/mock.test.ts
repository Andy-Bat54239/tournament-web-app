import { describe, expect, it } from "vitest";
import { MockLichess } from "./mock";

const NOW = new Date("2026-11-01T11:00:00Z");
const request = () => ({
  users: ["Grace", "Ronald"] as [string, string],
  clock: { limit: 300, increment: 2 },
  rules: "noRematch",
  expiresAt: new Date(Date.now() + 600_000),
  name: "Castle Connect",
});

describe("MockLichess game links", () => {
  it("creates distinct links that are open until someone joins", async () => {
    const lichess = new MockLichess();
    const a = await lichess.createGameLink(request());
    const b = await lichess.createGameLink(request());
    expect(a.id).not.toBe(b.id);
    expect(a.url).toBe(`https://lichess.org/${a.id}`);
    expect(await lichess.isLinkOpen(a.id)).toBe(true);
    expect(await lichess.getGame(a.id)).toBeNull(); // no game exists before both players join
  });

  it("starts a game when the players join, and the link stops being open", async () => {
    const lichess = new MockLichess();
    const { id } = await lichess.createGameLink(request());
    expect(lichess.simulate(id, "join", NOW)).toBe(true);
    expect(await lichess.isLinkOpen(id)).toBe(false);
    expect(await lichess.getGame(id)).toMatchObject({ status: "started", white: "Grace", black: "Ronald", winner: null, endedAt: null });
    expect(lichess.simulate(id, "join", NOW)).toBe(false); // cannot join twice
  });

  it("finishes a game with a win, a draw or an abort", async () => {
    const lichess = new MockLichess();
    const outcomes = { white: ["mate", "white"], black: ["mate", "black"], draw: ["draw", null], abort: ["aborted", null] } as const;
    for (const [event, [status, winner]] of Object.entries(outcomes)) {
      const { id } = await lichess.createGameLink(request());
      lichess.simulate(id, "join", NOW);
      expect(lichess.simulate(id, event as keyof typeof outcomes, NOW)).toBe(true);
      expect(await lichess.getGame(id)).toMatchObject({ status, winner, endedAt: NOW });
    }
  });

  it("will not finish a game that has not started, or one that is already over", async () => {
    const lichess = new MockLichess();
    const { id } = await lichess.createGameLink(request());
    expect(lichess.simulate(id, "white", NOW)).toBe(false);
    lichess.simulate(id, "join", NOW);
    lichess.simulate(id, "white", NOW);
    expect(lichess.simulate(id, "black", NOW)).toBe(false);
    expect(lichess.simulate("nope", "join", NOW)).toBe(false);
  });

  it("closes a link when it is cancelled, and refuses to start a game on it", async () => {
    const lichess = new MockLichess();
    const { id } = await lichess.createGameLink(request());
    await lichess.cancelLink(id);
    expect(await lichess.isLinkOpen(id)).toBe(false);
    expect(lichess.simulate(id, "join", NOW)).toBe(false);
    await expect(lichess.cancelLink("nope")).resolves.toBeUndefined();
  });

  it("treats an expired link as closed", async () => {
    const lichess = new MockLichess();
    const { id } = await lichess.createGameLink({ ...request(), expiresAt: new Date(Date.now() - 1000) });
    expect(await lichess.isLinkOpen(id)).toBe(false);
  });
});

describe("MockLichess profiles", () => {
  it("gives stable fake ratings, and 1722 to Mercy_K as in the prototype", async () => {
    const lichess = new MockLichess();
    expect(await lichess.getProfile("Mercy_K")).toEqual({ username: "Mercy_K", blitzRating: 1722, provisional: false });
    expect(await lichess.getProfile("Grace")).toEqual(await lichess.getProfile("Grace"));
    expect(await lichess.getProfile("not a name!")).toBeNull();
  });
});

describe("the simulated Swiss", () => {
  const names = Array.from({ length: 24 }, (_, i) => `Player_${i + 1}`);

  it("is finished unless told otherwise", async () => {
    const mock = new MockLichess();
    expect(await mock.getSwiss("AbCdEfGh")).toMatchObject({ status: "finished", round: 6, rounds: 6, ongoing: 0 });
  });

  it("can be moved along, from not started to finished", async () => {
    const mock = new MockLichess();
    expect(mock.simulateSwiss(0)).toBe(true);
    expect(await mock.getSwiss("AbCdEfGh")).toMatchObject({ status: "created", round: 0 });
    expect(mock.simulateSwiss(3)).toBe(true);
    expect(await mock.getSwiss("AbCdEfGh")).toMatchObject({ status: "started", round: 3, ongoing: 3 });
    expect(mock.simulateSwiss(null)).toBe(true);
    expect(await mock.getSwiss("AbCdEfGh")).toMatchObject({ status: "finished" });
  });

  it("refuses a round that does not exist", () => {
    const mock = new MockLichess();
    expect(mock.simulateSwiss(7)).toBe(false);
    expect(mock.simulateSwiss(-1)).toBe(false);
    expect(mock.simulateSwiss(2.5)).toBe(false);
  });

  it("has everyone on nothing before the first round, and the round being played not counted", async () => {
    const mock = new MockLichess();
    mock.simulateSwiss(1);
    const standings = await mock.getSwissStandings({ swissId: null, entrants: names });
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });

  it("gives more points as the rounds go, ending where the finished standings are", async () => {
    const mock = new MockLichess();
    const total = async () => (await mock.getSwissStandings({ swissId: null, entrants: names })).reduce((sum, s) => sum + s.points, 0);
    const totals: number[] = [];
    for (const round of [1, 3, 5, 6]) {
      mock.simulateSwiss(round);
      totals.push(await total());
    }
    mock.simulateSwiss(null);
    totals.push(await total());
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(totals[0]).toBe(0);
    expect(totals[4]).toBeGreaterThan(totals[3]);
  });

  it("ranks from 1 with the most points first, whatever the round", async () => {
    const mock = new MockLichess();
    mock.simulateSwiss(4);
    const standings = await mock.getSwissStandings({ swissId: null, entrants: names });
    expect(standings.map((s) => s.rank)).toEqual(names.map((_, i) => i + 1));
    expect(standings.map((s) => s.points)).toEqual([...standings.map((s) => s.points)].sort((a, b) => b - a));
  });
});
