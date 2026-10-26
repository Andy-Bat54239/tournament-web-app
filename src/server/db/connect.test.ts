import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPglite } from "./connect";
import { StateRepository } from "./repository";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "castle-connect-"));
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe("the local database", () => {
  it("is made in a folder that does not exist yet, folders above it included", async () => {
    const sql = await openPglite(join(root, ".data", "pglite"));
    await expect(sql.query("SELECT 1 AS one")).resolves.toEqual({ rows: [{ one: 1 }] });
    await sql.close();
  });

  it("still has the tournament after the server is stopped and started again", async () => {
    const dir = join(root, "pglite");

    const first = await openPglite(dir);
    const repository = new StateRepository<{ players: string[] }>(first);
    await repository.create("main", { players: ["Grace"] });
    await repository.save("main", { players: ["Grace", "Ronald"] }, 1);
    await first.close();

    const second = await openPglite(dir);
    expect(await new StateRepository<{ players: string[] }>(second).load("main")).toEqual({
      version: 2,
      state: { players: ["Grace", "Ronald"] },
    });
    await second.close();
  });
});
