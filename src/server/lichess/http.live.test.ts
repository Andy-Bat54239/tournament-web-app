import { describe, expect, it } from "vitest";
import { GAME_CLOCK, GAME_RULES, classifyGame, outcomeOf } from "@/domain/play";
import { HttpLichess } from "./http";

/**
 * Runs the live client against the real Lichess, with the three throwaway test accounts from
 * scripts/lichess-checks (see its README). Skipped unless you ask for it:
 *
 *   LICHESS_LIVE_TESTS=1 npx vitest run src/server/lichess/http.live.test.ts
 *
 * It creates a few unrated games between the test accounts and one restricted link, then closes them.
 */
const live = process.env.LICHESS_LIVE_TESTS === "1";

if (live) {
  try {
    process.loadEnvFile("scripts/lichess-checks/.env.local");
  } catch {
    // Fall back to whatever is already in the environment.
  }
}

const BASE = "https://lichess.org";

async function call(token: string, method: string, path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function username(token: string): Promise<string> {
  return ((await call(token, "GET", "/api/account")).json as { username: string }).username;
}

describe.skipIf(!live)("the live Lichess client", () => {
  const A = process.env.LICHESS_A_TOKEN ?? "";
  const B = process.env.LICHESS_B_TOKEN ?? "";
  const C = process.env.LICHESS_C_TOKEN ?? "";
  // A is the service account that creates the links, as in production.
  const lichess = new HttpLichess({ token: A });
  const request = (users: [string, string]) => ({
    users,
    clock: GAME_CLOCK,
    rules: GAME_RULES,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    name: "Castle Connect live check",
  });

  it("needs three tokens", () => {
    expect([A, B, C].every((t) => t.startsWith("lip_"))).toBe(true);
  });

  it("makes a restricted link, hands out a result, and reads it the way the app does", { timeout: 90_000 }, async () => {
    const [a, b] = await Promise.all([username(A), username(B)]);

    // 1. A link for A (White) and B, using the app's own clock and rules.
    const link = await lichess.createGameLink(request([a, b]));
    expect(link.url).toBe(`https://lichess.org/${link.id}`);
    expect(await lichess.isLinkOpen(link.id)).toBe(true);
    expect(await lichess.getGame(link.id)).toBeNull(); // no game until both have joined

    // 2. Someone not named is refused. This is the check the whole design depends on.
    const outsider = await call(C, "POST", `/api/challenge/${link.id}/accept`);
    expect(outsider.status).toBe(400);
    expect(await lichess.getGame(link.id)).toBeNull();

    // 3. The two named players join, and White is the first name given.
    expect((await call(A, "POST", `/api/challenge/${link.id}/accept`)).status).toBe(200);
    expect((await call(B, "POST", `/api/challenge/${link.id}/accept`)).status).toBe(200);
    const started = await lichess.getGame(link.id);
    expect(started).toMatchObject({ status: "started", white: a, black: b, winner: null, endedAt: null });
    expect(classifyGame(started!.status, started!.winner)).toEqual({ kind: "ongoing" });
    expect(await lichess.isLinkOpen(link.id)).toBe(false); // the game has started, so the link is used up

    // 4. Fool's mate: Black wins. The app maps that to the lower seed in game 1.
    for (const [who, uci] of [[A, "f2f3"], [B, "e7e5"], [A, "g2g4"], [B, "d8h4"]] as const) {
      expect((await call(who, "POST", `/api/board/game/${link.id}/move/${uci}`)).status).toBe(200);
    }
    const finished = await lichess.getGame(link.id);
    expect(finished).toMatchObject({ status: "mate", winner: "black", white: a, black: b });
    expect(finished!.endedAt).toBeInstanceOf(Date);
    const verdict = classifyGame(finished!.status, finished!.winner);
    expect(verdict).toEqual({ kind: "result", winner: "black" });
    expect(outcomeOf(1, "black")).toBe("lo");
  });

  it("reads an abort as not played", { timeout: 60_000 }, async () => {
    const [a, b] = await Promise.all([username(A), username(B)]);
    const link = await lichess.createGameLink(request([b, a])); // B has White this time
    await call(A, "POST", `/api/challenge/${link.id}/accept`);
    await call(B, "POST", `/api/challenge/${link.id}/accept`);
    expect((await call(B, "POST", `/api/board/game/${link.id}/abort`)).status).toBe(200);
    const game = await lichess.getGame(link.id);
    expect(game).toMatchObject({ status: "aborted", winner: null, white: b, black: a });
    expect(classifyGame(game!.status, game!.winner)).toEqual({ kind: "not_played" });
  });

  it("closes a link nobody used, and tolerates closing it twice", { timeout: 60_000 }, async () => {
    const [a, b] = await Promise.all([username(A), username(B)]);
    const link = await lichess.createGameLink(request([a, b]));
    expect(await lichess.isLinkOpen(link.id)).toBe(true);
    await lichess.cancelLink(link.id);
    expect(await lichess.isLinkOpen(link.id)).toBe(false);
    await expect(lichess.cancelLink(link.id)).resolves.toBeUndefined();
    await expect(lichess.cancelLink("zzzzzzzz")).resolves.toBeUndefined();
  });

  it("refuses the admin-only noAbort rule with a clear error", async () => {
    const [a, b] = await Promise.all([username(A), username(B)]);
    await expect(lichess.createGameLink({ ...request([a, b]), rules: "noAbort" })).rejects.toThrow(/noAbort/);
  });

  it("returns null for a game that does not exist", async () => {
    expect(await lichess.getGame("zzzzzzzz")).toBeNull();
  });

  it("reads a profile, showing a brand-new rating as provisional, and an unknown account as null", async () => {
    const [a] = await Promise.all([username(A)]);
    expect(await lichess.getProfile(a)).toEqual({ username: a, blitzRating: null, provisional: true });
    expect(await lichess.getProfile("no-such-user-zzqq9")).toBeNull();
  });

  it("reads a finished Swiss's standings with Lichess's own ranks", async () => {
    const standings = await lichess.getSwissStandings({ swissId: "FgUapYId", entrants: [] });
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(standings[0]).toEqual({ rank: 1, username: "patience-mushishi", points: 2 });
  });

  it("reads how far a Swiss has got, and returns null for one that does not exist", async () => {
    expect(await lichess.getSwiss("FgUapYId")).toEqual({
      id: "FgUapYId",
      name: "CC api check: no-show",
      status: "finished",
      round: 2,
      rounds: 2, // it was planned for 3 and Lichess ended it early, as docs/lichess-checks.md says
      players: 3,
      ongoing: 0,
    });
    expect(await lichess.getSwiss("ZZZZZZZZ")).toBeNull();
  });
});
