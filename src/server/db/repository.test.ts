import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databases } from "@/test/databases";
import { StateRepository } from "./repository";
import type { Sql } from "./sql";

const tableName = () => `state_${Math.random().toString(36).slice(2, 10)}`;

describe.each(databases)("the state repository on $name", (database) => {
  let sql: Sql;
  let close: () => Promise<void>;
  const tables: string[] = [];

  beforeAll(async () => {
    ({ sql, close } = await database.open());
  });

  afterAll(async () => {
    for (const table of tables) await sql.query(`DROP TABLE IF EXISTS ${table}`);
    await close();
  });

  const repo = () => {
    const table = tableName();
    tables.push(table);
    return new StateRepository<Record<string, unknown>>(sql, table);
  };

  it("makes its table on first use, and making it again is harmless", async () => {
    const r = repo();
    await r.ensureSchema();
    await r.ensureSchema();
    expect(await r.load("main")).toBeNull();
  });

  it("copes with several servers starting at once", async () => {
    const table = tableName();
    tables.push(table);
    const servers = Array.from({ length: 5 }, () => new StateRepository(sql, table));
    await expect(Promise.all(servers.map((s) => s.ensureSchema()))).resolves.toBeDefined();
  });

  it("has nothing stored until something is", async () => {
    expect(await repo().load("main")).toBeNull();
  });

  it("stores the first version once, and keeps it if another server tries to store its own", async () => {
    const r = repo();
    expect(await r.create("main", { who: "first" })).toBe(true);
    expect(await r.create("main", { who: "second" })).toBe(false);
    expect(await r.load("main")).toEqual({ version: 1, state: { who: "first" } });
  });

  it("moves the version on by one with every save", async () => {
    const r = repo();
    await r.create("main", { n: 0 });
    expect(await r.save("main", { n: 1 }, 1)).toBe(2);
    expect(await r.save("main", { n: 2 }, 2)).toBe(3);
    expect(await r.load("main")).toEqual({ version: 3, state: { n: 2 } });
  });

  it("refuses a save made from an old version, and leaves what is stored alone", async () => {
    const r = repo();
    await r.create("main", { n: 0 });
    await r.save("main", { n: 1 }, 1);
    expect(await r.save("main", { n: 99 }, 1)).toBeNull();
    expect(await r.load("main")).toEqual({ version: 2, state: { n: 1 } });
  });

  it("lets only the first of two writers who read the same version save", async () => {
    const r = repo();
    await r.create("main", { items: [] });
    const a = (await r.load("main"))!;
    const b = (await r.load("main"))!;
    expect(await r.save("main", { items: ["from a"] }, a.version)).toBe(2);
    expect(await r.save("main", { items: ["from b"] }, b.version)).toBeNull();
    expect((await r.load("main"))!.state).toEqual({ items: ["from a"] });
  });

  it("only ever lets one of several simultaneous saves through", async () => {
    const r = repo();
    await r.create("main", { n: 0 });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => r.save("main", { n: i + 1 }, 1)));
    expect(results.filter((v) => v === 2)).toHaveLength(1);
    expect(results.filter((v) => v === null)).toHaveLength(5);
  });

  it("keeps different ids apart", async () => {
    const r = repo();
    await r.create("a", { who: "a" });
    await r.create("b", { who: "b" });
    await r.save("a", { who: "a2" }, 1);
    expect(await r.load("a")).toEqual({ version: 2, state: { who: "a2" } });
    expect(await r.load("b")).toEqual({ version: 1, state: { who: "b" } });
  });

  it("round-trips nested data, unicode, nulls and ISO times exactly", async () => {
    const r = repo();
    const state = {
      name: "Mercy’s café ☕ 国际象棋",
      startsAt: "2026-11-01T11:00:00.000Z",
      nested: { list: [1, 2.5, null, "x", { deep: [] }], empty: {}, nothing: null },
      big: 9007199254740991,
    };
    await r.create("main", state);
    expect((await r.load("main"))!.state).toEqual(state);
  });

  it("treats an id as plain text, never as SQL", async () => {
    const r = repo();
    const sneaky = "main'; DROP TABLE x; --";
    await r.create(sneaky, { ok: true });
    expect(await r.load(sneaky)).toEqual({ version: 1, state: { ok: true } });
    expect(await r.load("main")).toBeNull();
  });
});

describe("the state repository's table name", () => {
  it("is checked, because it is the one thing that goes into SQL as text", async () => {
    const sql = { query: async () => ({ rows: [] }), close: async () => {} };
    for (const bad of ["x; DROP TABLE y", "Robert'--", "a b", "", "1abc", "tournament-state"]) {
      expect(() => new StateRepository(sql, bad)).toThrow(/safe table name/);
    }
    expect(() => new StateRepository(sql, "tournament_state")).not.toThrow();
  });
});
