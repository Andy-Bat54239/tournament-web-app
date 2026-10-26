import { describe, expect, it } from "vitest";
import { HttpLichess } from "./http";
import { LichessError, LichessRateLimited } from "./types";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: URLSearchParams | undefined;
}

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(replies: Array<{ status?: number; body?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const impl = (async (input: URL, init: { method: string; headers: Record<string, string>; body?: URLSearchParams }) => {
    calls.push({ method: init.method, url: input, headers: init.headers, body: init.body });
    const reply = replies.shift() ?? { status: 500, text: "no reply scripted" };
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const make = (replies: Parameters<typeof fakeFetch>[0]) => {
  const { impl, calls } = fakeFetch(replies);
  return { lichess: new HttpLichess({ token: "lip_test", fetchImpl: impl }), calls };
};

describe("createGameLink", () => {
  it("makes a restricted, unrated open challenge with White first and the app's rules", async () => {
    const { lichess, calls } = make([{ body: { id: "Ma2fqfRs", url: "https://lichess.org/game/Ma2fqfRs", status: "created" } }]);
    const expiresAt = new Date("2026-11-01T11:20:00Z");
    const link = await lichess.createGameLink({
      users: ["Grace", "Ronald"],
      clock: { limit: 300, increment: 2 },
      rules: "noRematch,noEarlyDraw",
      expiresAt,
      name: "Castle Connect: Quarterfinal 1",
    });

    expect(link).toEqual({ id: "Ma2fqfRs", url: "https://lichess.org/Ma2fqfRs" });
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/api/challenge/open");
    expect(call.headers.Authorization).toBe("Bearer lip_test");
    expect(Object.fromEntries(call.body!)).toEqual({
      "clock.limit": "300",
      "clock.increment": "2",
      rated: "false",
      users: "Grace,Ronald",
      rules: "noRematch,noEarlyDraw",
      name: "Castle Connect: Quarterfinal 1",
      expiresAt: String(expiresAt.getTime()),
    });
  });

  it("reports Lichess's refusal, such as the admin-only noAbort rule", async () => {
    const { lichess } = make([{ status: 400, body: { error: { global: ["The `noAbort` rule is now restricted to challenge administrators"] } } }]);
    await expect(
      lichess.createGameLink({ users: ["a", "b"], clock: { limit: 300, increment: 2 }, rules: "noAbort", expiresAt: new Date(), name: "x" }),
    ).rejects.toThrow(/noAbort/);
  });
});

describe("getGame", () => {
  const exported = (extra: object) => ({
    id: "GIASrqoB",
    rated: false,
    speed: "blitz",
    createdAt: 1_793_000_000_000,
    lastMoveAt: 1_793_000_090_000,
    players: { white: { user: { name: "andybat7", id: "andybat7" } }, black: { user: { name: "andybat22", id: "andybat22" } } },
    ...extra,
  });

  it("reads a finished game with its winner and when it ended", async () => {
    const { lichess, calls } = make([{ body: exported({ status: "mate", winner: "black" }) }]);
    expect(await lichess.getGame("GIASrqoB")).toEqual({
      id: "GIASrqoB",
      status: "mate",
      winner: "black",
      white: "andybat7",
      black: "andybat22",
      endedAt: new Date(1_793_000_090_000),
    });
    expect(calls[0].url.pathname).toBe("/game/export/GIASrqoB");
    expect(calls[0].headers.Authorization).toBeUndefined(); // the export is public
  });

  it("reads a draw and an abort as having no winner", async () => {
    const { lichess } = make([{ body: exported({ status: "draw" }) }, { body: exported({ status: "aborted" }) }]);
    expect(await lichess.getGame("a")).toMatchObject({ status: "draw", winner: null });
    expect(await lichess.getGame("b")).toMatchObject({ status: "aborted", winner: null });
  });

  it("gives no end time while the game is still being played", async () => {
    const { lichess } = make([{ body: exported({ status: "started" }) }]);
    expect(await lichess.getGame("a")).toMatchObject({ status: "started", endedAt: null });
  });

  it("returns null when no game exists yet, because the players have not joined", async () => {
    const { lichess } = make([{ status: 404, body: { error: "Not found" } }]);
    expect(await lichess.getGame("a")).toBeNull();
  });

  it("raises on any other failure", async () => {
    const { lichess } = make([{ status: 500, text: "boom" }]);
    await expect(lichess.getGame("a")).rejects.toBeInstanceOf(LichessError);
  });
});

describe("isLinkOpen and cancelLink", () => {
  it("is open only while the challenge is created", async () => {
    const { lichess, calls } = make([{ body: { status: "created" } }, { body: { status: "canceled" } }, { status: 404, body: { error: "Not found" } }]);
    expect(await lichess.isLinkOpen("a")).toBe(true);
    expect(await lichess.isLinkOpen("a")).toBe(false);
    expect(await lichess.isLinkOpen("a")).toBe(false);
    expect(calls[0].url.pathname).toBe("/api/challenge/a/show");
    expect(calls[0].headers.Authorization).toBe("Bearer lip_test");
  });

  it("cancels, and does not mind a link that is already gone", async () => {
    const { lichess, calls } = make([{ body: { ok: true } }, { status: 404, body: {} }, { status: 400, body: { error: "The challenge has been canceled." } }]);
    await lichess.cancelLink("a");
    await lichess.cancelLink("b");
    await lichess.cancelLink("c");
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /api/challenge/a/cancel",
      "POST /api/challenge/b/cancel",
      "POST /api/challenge/c/cancel",
    ]);
  });

  it("raises when cancelling fails for another reason", async () => {
    const { lichess } = make([{ status: 500, text: "boom" }]);
    await expect(lichess.cancelLink("a")).rejects.toBeInstanceOf(LichessError);
  });
});

describe("getProfile", () => {
  it("shows a provisional blitz rating as new", async () => {
    const { lichess } = make([{ body: { id: "andybat22", username: "andybat22", perfs: { blitz: { games: 0, rating: 1500, rd: 500, prog: 0, prov: true } } } }]);
    expect(await lichess.getProfile("andybat22")).toEqual({ username: "andybat22", blitzRating: null, provisional: true });
  });

  it("reads an established rating, and returns null for an unknown account", async () => {
    const { lichess } = make([{ body: { username: "Grace", perfs: { blitz: { games: 120, rating: 1722, rd: 60, prog: 4 } } } }, { status: 404, body: { error: "Not found" } }]);
    expect(await lichess.getProfile("Grace")).toEqual({ username: "Grace", blitzRating: 1722, provisional: false });
    expect(await lichess.getProfile("nobody")).toBeNull();
  });
});

describe("getSwissStandings", () => {
  it("reads Lichess's own ranks, one result per line", async () => {
    const lines = [
      { rank: 1, points: 2, tieBreak: 1.5, rating: 1500, username: "patience-mushishi", performance: 2000 },
      { rank: 2, points: 1, tieBreak: 0, rating: 1500, username: "andybat22", performance: 1500, absent: true },
    ];
    const { lichess } = make([{ text: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" }]);
    expect(await lichess.getSwissStandings({ swissId: "FgUapYId", entrants: [] })).toEqual([
      { rank: 1, username: "patience-mushishi", points: 2 },
      { rank: 2, username: "andybat22", points: 1 },
    ]);
  });

  it("needs a tournament id", async () => {
    const { lichess } = make([]);
    await expect(lichess.getSwissStandings({ swissId: null, entrants: [] })).rejects.toBeInstanceOf(LichessError);
  });
});

describe("getSwiss", () => {
  const finished = {
    id: "FgUapYId",
    createdBy: "andybat7",
    name: "CC api check: no-show",
    round: 2,
    nbRounds: 2,
    nbPlayers: 3,
    nbOngoing: 0,
    status: "finished",
  };

  it("says how far the Swiss has got", async () => {
    const { lichess, calls } = make([{ body: finished }, { body: { ...finished, status: "started", round: 3, nbRounds: 5, nbOngoing: 14 } }]);
    expect(await lichess.getSwiss("FgUapYId")).toEqual({ id: "FgUapYId", name: "CC api check: no-show", status: "finished", round: 2, rounds: 2, players: 3, ongoing: 0 });
    expect(calls[0].url.pathname).toBe("/api/swiss/FgUapYId");
    expect(await lichess.getSwiss("FgUapYId")).toMatchObject({ status: "started", round: 3, rounds: 5, ongoing: 14 });
  });

  it("returns null when there is no such Swiss", async () => {
    const { lichess } = make([{ status: 404, body: { error: "Not found" } }]);
    expect(await lichess.getSwiss("ZZZZZZZZ")).toBeNull();
  });

  it("complains when Lichess answers with something else", async () => {
    const { lichess } = make([{ body: { id: "x", status: "weird" } }, { status: 500, text: "oops" }]);
    await expect(lichess.getSwiss("FgUapYId")).rejects.toBeInstanceOf(LichessError);
    await expect(lichess.getSwiss("FgUapYId")).rejects.toBeInstanceOf(LichessError);
  });

  it("knows it is the real Lichess", () => {
    expect(make([]).lichess.live).toBe(true);
  });
});

describe("requests", () => {
  it("stops on a 429 instead of retrying, as Lichess asks", async () => {
    const { lichess, calls } = make([{ status: 429, text: "Too many requests" }]);
    await expect(lichess.getGame("a")).rejects.toBeInstanceOf(LichessRateLimited);
    expect(calls).toHaveLength(1);
  });

  it("makes one request at a time", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const impl = (async (input: URL) => {
      order.push(`start ${input.pathname}`);
      if (input.pathname.endsWith("/first")) await gate;
      order.push(`end ${input.pathname}`);
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const lichess = new HttpLichess({ token: "t", fetchImpl: impl });

    const first = lichess.getGame("first");
    const second = lichess.getGame("second");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["start /game/export/first"]); // the second waits
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["start /game/export/first", "end /game/export/first", "start /game/export/second", "end /game/export/second"]);
  });

  it("keeps going after a failed request", async () => {
    const { lichess } = make([{ status: 429, text: "slow down" }, { status: 404, body: {} }]);
    await expect(lichess.getGame("a")).rejects.toBeInstanceOf(LichessRateLimited);
    expect(await lichess.getGame("b")).toBeNull();
  });
});
