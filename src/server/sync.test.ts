import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, setup } from "@/test/fixtures";
import { inProcess } from "@/test/databases";
import { StateRepository } from "./db/repository";
import type { Sql } from "./db/sql";
import { RATE_LIMITED } from "./lichess/ask";
import { MockLichess, type SimulatedEvent } from "./lichess/mock";
import { LichessError, LichessRateLimited, type LichessGame } from "./lichess/types";
import { StoreProvider } from "./provider";
import type { PersistedState } from "./store";
import { hasSecret, readOpenGames } from "./sync";

let sql: Sql;
let close: () => Promise<void>;
let lichess: MockLichess;
let provider: StoreProvider;

beforeEach(async () => {
  ({ sql, close } = await inProcess.open());
  lichess = new MockLichess();
  provider = new StoreProvider(new StateRepository<PersistedState>(sql), {
    superAdmin: "Joel",
    initial: () => setup().store.snapshot(),
    closeLink: async () => {},
    pause: async () => {},
  });
});

afterEach(() => close());

/** The player taps ready and gets the link, as the match screen does. Returns the link id. */
async function linkFor(player: string, matchId: string): Promise<string> {
  await provider.update(async (store) => {
    store.play.markReady(player, at(10));
    return store.play.ensureLink(player, lichess, at(11));
  });
  return (await provider.read()).tournament.play[matchId].round!.link!.id;
}

const play = (id: string, ...events: SimulatedEvent[]) => events.forEach((e, i) => lichess.simulate(id, e, at(20 + i)));
const stored = async () => (await provider.read()).tournament;

describe("reading games nobody is watching", () => {
  it("does nothing, and asks Lichess nothing, when no game has a link out", async () => {
    const asked: string[] = [];
    const spy = Object.assign(Object.create(lichess), { getGame: async (id: string) => {
        asked.push(id);
        return null;
      },
    });
    expect(await readOpenGames(provider, spy)).toEqual({ checked: 0, changed: 0, stopped: null, failed: 0 });
    expect(asked).toEqual([]);
  });

  it("turns a finished game into a result and starts the next waiting time", async () => {
    const id = await linkFor("P01", "r1m1");
    play(id, "join", "white");

    expect(await readOpenGames(provider, lichess)).toEqual({ checked: 1, changed: 1, stopped: null, failed: 0 });

    const t = await stored();
    expect(t.records.r1m1.games).toHaveLength(1);
    expect(t.records.r1m1.games[0]).toMatchObject({ outcome: "hi", source: "lichess", lichessId: id });
    expect(t.play.r1m1.round).toMatchObject({ game: 2 });
    expect(t.play.r1m1.round!.link).toBeUndefined();
    expect((await provider.read()).audit.at(-1)).toMatchObject({ actor: "Lichess", action: expect.stringContaining("read the result of game 1") });
  });

  it("does not read the same game twice", async () => {
    const id = await linkFor("P01", "r1m1");
    play(id, "join", "white");
    await readOpenGames(provider, lichess);
    expect(await readOpenGames(provider, lichess)).toMatchObject({ checked: 0, changed: 0 });
    expect((await stored()).records.r1m1.games).toHaveLength(1);
  });

  it("notes that a game has started, once, and then has no news until it ends", async () => {
    const id = await linkFor("P01", "r1m1");
    play(id, "join");
    expect(await readOpenGames(provider, lichess)).toMatchObject({ checked: 1, changed: 1 });
    expect((await stored()).play.r1m1.round!.joined).toBe(true);
    expect(await readOpenGames(provider, lichess)).toMatchObject({ checked: 1, changed: 0 });
  });

  it("does not save when there was no news", async () => {
    await linkFor("P01", "r1m1");
    const before = (await new StateRepository<PersistedState>(sql).load("main"))!.version;
    await readOpenGames(provider, lichess); // nobody has joined, so there is no game yet
    expect((await new StateRepository<PersistedState>(sql).load("main"))!.version).toBe(before);
  });

  it("counts an aborted game as not played, and asks the players to tap ready again", async () => {
    const id = await linkFor("P01", "r1m1");
    play(id, "join", "abort");
    expect(await readOpenGames(provider, lichess)).toMatchObject({ checked: 1, changed: 1 });
    const t = await stored();
    expect(t.records.r1m1).toBeUndefined();
    expect(t.play.r1m1).toMatchObject({ aborts: 1, round: { game: 1, ready: {} } });
  });

  it("reads every match that has a game out", async () => {
    const a = await linkFor("P01", "r1m1");
    const b = await linkFor("P04", "r1m2");
    play(a, "join", "white");
    play(b, "join", "black");
    expect(await readOpenGames(provider, lichess)).toEqual({ checked: 2, changed: 2, stopped: null, failed: 0 });
    const t = await stored();
    expect(t.records.r1m1.games[0].outcome).toBe("hi");
    expect(t.records.r1m2.games[0].outcome).toBe("lo");
  });
});

/** The mock, except that reading a game goes through the given function. */
function lichessWhere(getGame: (id: string, real: () => Promise<LichessGame | null>) => Promise<LichessGame | null>) {
  return Object.assign(Object.create(lichess), {
    getGame: (id: string) => getGame(id, () => lichess.getGame(id)),
  }) as MockLichess;
}

describe("when Lichess does not cooperate", () => {
  it("stops at once if Lichess says it is busy, and leaves the other matches for next time", async () => {
    const a = await linkFor("P01", "r1m1");
    const b = await linkFor("P04", "r1m2");
    play(a, "join", "white");
    play(b, "join", "white");
    const asked: string[] = [];
    const busy = lichessWhere(async (id) => {
      asked.push(id);
      throw new LichessRateLimited("429");
    });

    expect(await readOpenGames(provider, busy)).toEqual({ checked: 1, changed: 0, stopped: RATE_LIMITED, failed: 1 });
    expect(asked).toHaveLength(1);
    expect((await stored()).records).toEqual({});

    // A minute later it is fine, and both are read.
    expect(await readOpenGames(provider, lichess)).toMatchObject({ checked: 2, changed: 2, stopped: null });
  });

  it("carries on past a game it could not read", async () => {
    const a = await linkFor("P01", "r1m1");
    const b = await linkFor("P04", "r1m2");
    play(a, "join", "white");
    play(b, "join", "white");
    const broken = lichessWhere(async (id, real) => {
      if (id === a) throw new LichessError("HTTP 500");
      return real();
    });

    expect(await readOpenGames(provider, broken)).toEqual({ checked: 2, changed: 1, stopped: null, failed: 1 });
    const t = await stored();
    expect(t.records.r1m1).toBeUndefined();
    expect(t.records.r1m2.games).toHaveLength(1);
    expect(t.play.r1m1.round!.link?.id).toBe(a); // still there to be read next time
  });
});

describe("the shared secret", () => {
  it("accepts exactly the bearer secret", () => {
    expect(hasSecret("Bearer s3cret", "s3cret")).toBe(true);
    for (const bad of [null, "", "s3cret", "Bearer s3cre", "Bearer s3cret ", "bearer s3cret", "Bearer other!", "Basic s3cret"]) {
      expect(hasSecret(bad, "s3cret"), String(bad)).toBe(false);
    }
  });

  it("accepts nothing when no secret is set, so the door is never left open", () => {
    expect(hasSecret("Bearer ", "")).toBe(false);
    expect(hasSecret("Bearer undefined", undefined)).toBe(false);
    expect(hasSecret(null, undefined)).toBe(false);
  });
});
