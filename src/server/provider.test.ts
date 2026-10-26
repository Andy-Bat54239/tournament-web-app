import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, setup } from "@/test/fixtures";
import { inProcess } from "@/test/databases";
import { StateRepository } from "./db/repository";
import type { Sql } from "./db/sql";
import { MockLichess } from "./lichess/mock";
import { StoreBusy, StoreProvider } from "./provider";
import type { PersistedState } from "./store";

let sql: Sql;
let close: () => Promise<void>;
let lichess: MockLichess;
let closed: string[];

beforeEach(async () => {
  ({ sql, close } = await inProcess.open());
  lichess = new MockLichess();
  closed = [];
});

afterEach(() => close());

const initial = (): PersistedState => setup().store.snapshot();

/** A server: its own provider over the shared database, as a second server or a restarted one would be. */
function server(overrides: { attempts?: number; repository?: StateRepository<PersistedState> } = {}) {
  return new StoreProvider(overrides.repository ?? new StateRepository<PersistedState>(sql), {
    superAdmin: "Joel",
    initial,
    closeLink: async (id) => {
      closed.push(id);
      await lichess.cancelLink(id);
    },
    attempts: overrides.attempts,
    pause: async () => {},
  });
}

const versionNow = async () => (await new StateRepository<PersistedState>(sql).load("main"))!.version;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the first run", () => {
  it("starts the tournament from the initial state, once, however many servers start together", async () => {
    const servers = [server(), server(), server()];
    const stores = await Promise.all(servers.map((s) => s.read()));
    expect(stores.map((s) => s.tournament.name)).toEqual(["Test", "Test", "Test"]);
    expect(await versionNow()).toBe(1);
  });
});

describe("reading", () => {
  it("shows what was saved, even by a server that has just restarted", async () => {
    await server().update((store) => store.log("Joel", at(5), "Before the restart"));
    const afterRestart = await server().read();
    expect(afterRestart.audit.at(-1)).toMatchObject({ action: "Before the restart" });
  });

  it("does not save changes made to the copy it gives out", async () => {
    const copy = await server().read();
    copy.log("Joel", at(5), "Never saved");
    expect((await server().read()).audit.some((a) => a.action === "Never saved")).toBe(false);
  });
});

describe("updating", () => {
  it("saves a change and gives back what the change returned", async () => {
    const result = await server().update((store) => store.changeSchedule("Joel", { date: "2026-12-01", time: "15:00", reason: "Venue" }, at(5)));
    expect(result).toEqual({ ok: true });
    expect((await server().read()).tournament.scheduleChange).toMatchObject({ reason: "Venue", by: "Joel" });
    expect(await versionNow()).toBe(2);
  });

  it("saves nothing, and leaves the version alone, when the change did nothing", async () => {
    await server().read();
    const refused = await server().update((store) => store.changeSchedule("Nobody", { date: "2026-12-01", time: "15:00", reason: "x" }, at(5)));
    expect(refused.ok).toBe(false);
    expect(await versionNow()).toBe(1);
  });

  it("saves nothing when the change throws, and passes the error on", async () => {
    await expect(
      server().update((store) => {
        store.log("Joel", at(5), "Half done");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await server().read()).audit.some((a) => a.action === "Half done")).toBe(false);
  });

  it("keeps every change when many are made at the same moment", async () => {
    const writers = Array.from({ length: 6 }, (_, i) =>
      server().update(async (store) => {
        await tick(); // all of them have loaded the same version by now
        store.log("Joel", at(10 + i), `Change ${i}`);
        return i;
      }),
    );
    expect((await Promise.all(writers)).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const actions = (await server().read()).audit.map((a) => a.action);
    for (let i = 0; i < 6; i++) expect(actions).toContain(`Change ${i}`);
    expect(actions.filter((a) => a.startsWith("Change "))).toHaveLength(6);
  });

  it("makes the change again on the newer state, not on the one it first read", async () => {
    let seen = 0;
    const slow = server().update(async (store) => {
      seen = store.registrations.length;
      await tick();
      store.registrations = store.registrations.slice(0, -1);
    });
    await tick();
    await server().update((store) => {
      store.registrations = store.registrations.slice(0, -1);
    });
    await slow;
    expect(seen).toBeGreaterThan(0);
    expect((await server().read()).registrations).toHaveLength(18); // 20, minus one from each, not minus one in all
  });

  it("gives up, saving nothing, if it loses the race every time", async () => {
    const repository = new StateRepository<PersistedState>(sql);
    const loses = Object.assign(Object.create(repository), { save: async () => null }) as StateRepository<PersistedState>;
    await server().read();
    await expect(server({ repository: loses, attempts: 3 }).update((s) => s.log("Joel", at(5), "Lost"))).rejects.toBeInstanceOf(StoreBusy);
    expect(await versionNow()).toBe(1);
  });
});

describe("game links", () => {
  async function ready(...players: string[]) {
    await server().update((store) => {
      for (const p of players) store.play.markReady(p, at(10));
    });
  }

  it("closes the links a saved change has finished with, once it is saved", async () => {
    await ready("P01", "P08");
    const link = await server().update((store) => store.play.ensureLink("P01", lichess, at(11)));
    expect(link.ok).toBe(true);
    const id = (await server().read()).tournament.play.r1m1.round!.link!.id;

    await server().update((store) => store.resetBracket("Joel", "Wrong cut-off", at(50)));
    expect(closed).toEqual([id]);
  });

  it("gives both players the same link when they ask at once, and never closes the one kept", async () => {
    await ready("P01", "P08");
    const [a, b] = await Promise.all([
      server().update((store) => store.play.ensureLink("P01", lichess, at(11))),
      server().update((store) => store.play.ensureLink("P08", lichess, at(11))),
    ]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    // A server that made its own link a moment too late loses the save and closes that one, not the kept one.
    const kept = (await server().read()).tournament.play.r1m1.round!.link!.id;
    expect(closed).not.toContain(kept);
    expect(closed.length).toBeLessThanOrEqual(1);
    expect(await lichess.isLinkOpen(kept)).toBe(true);
  });

  it("closes a link that was made but never saved", async () => {
    await ready("P01", "P08");
    await expect(
      server().update(async (store) => {
        await store.play.ensureLink("P01", lichess, at(11));
        throw new Error("crashed before saving");
      }),
    ).rejects.toThrow("crashed");
    expect(closed).toHaveLength(1);
    expect((await server().read()).tournament.play.r1m1.round!.link).toBeUndefined();
  });

  it("closes the link of a change that lost the race, and keeps the one the retry made", async () => {
    await ready("P01", "P08");
    let attempts = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (entered = resolve));

    const slow = server().update(async (store) => {
      attempts++;
      const link = await store.play.ensureLink("P01", lichess, at(11));
      if (attempts === 1) {
        entered();
        await gate; // meanwhile, somebody else saves
      }
      return link;
    });
    await inside;
    await server().update((store) => store.log("Joel", at(12), "Someone else got in first"));
    release();

    expect((await slow).ok).toBe(true);
    expect(attempts).toBe(2);
    const final = (await server().read()).tournament.play.r1m1.round!.link!.id;
    expect(closed).toHaveLength(1);
    expect(closed[0]).not.toBe(final); // the first attempt's link is closed, the retry's is kept
    expect(await lichess.isLinkOpen(final)).toBe(true);
  });
});
