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
