import { describe, expect, it } from "vitest";
import { setup } from "@/test/fixtures";
import { MockLichess } from "./lichess/mock";
import { LichessError, type StandingRow, type SwissInfo } from "./lichess/types";
import { standingsFor, swissStandings } from "./swiss";
import { SwissFeed } from "./swiss-feed";

const info = (over: Partial<SwissInfo> = {}): SwissInfo => ({
  id: "FgUapYId",
  name: "Castle Connect Swiss",
  status: "finished",
  round: 5,
  rounds: 5,
  players: 36,
  ongoing: 0,
  ...over,
});

/** The real Lichess, as far as the app can tell, with scripted answers. */
class FakeLive extends MockLichess {
  override readonly live = true;
  calls: string[] = [];
  constructor(
    private swiss: SwissInfo | null,
    private rows: StandingRow[] = [],
    public broken = false,
  ) {
    super();
  }
  override async getSwiss(id: string) {
    this.calls.push(`swiss ${id}`);
    if (this.broken) throw new LichessError("down");
    return this.swiss;
  }
  override async getSwissStandings(input: { swissId: string | null; entrants: string[] }) {
    this.calls.push(`standings ${input.swissId}`);
    return this.rows;
  }
}

const rows: StandingRow[] = [
  { rank: 1, username: "P05", points: 5 },
  { rank: 2, username: "P01", points: 4.5 },
];

function swissWorld() {
  const w = setup(); // 20 players, which is a Swiss and then a top 16
  w.store.tournament.bracket = null;
  w.store.tournament.qualifiers = null;
  return w;
}

describe("the standings the bracket is built from", () => {
  it("needs none for a straight knockout, and does not ask Lichess", async () => {
    const w = swissWorld();
    w.store.registrations = w.store.registrations.slice(0, 8);
    const lichess = new FakeLive(null);
    expect(await standingsFor(w.store, lichess)).toEqual({ ok: true, standings: null });
    expect(lichess.calls).toEqual([]);
  });

  it("asks for a Swiss to be chosen on the real Lichess", async () => {
    const w = swissWorld();
    const result = await standingsFor(w.store, new FakeLive(info(), rows));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Choose the Lichess Swiss") });
  });

  it("invents standings on the stand-in, with no Swiss chosen", async () => {
    const w = swissWorld();
    const result = await standingsFor(w.store, new MockLichess());
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.standings).toHaveLength(20);
  });

  it("refuses a Swiss that is still being played, and says where it has got to", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info({ status: "started", round: 3, ongoing: 14 }), rows);
    const result = await standingsFor(w.store, lichess);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("round 3 of 5, 14 games still being played") });
    expect(lichess.calls).toEqual(["swiss FgUapYId"]); // the standings were never read
  });

  it("says so when Lichess has no such Swiss", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    expect(await standingsFor(w.store, new FakeLive(null))).toMatchObject({ ok: false, error: expect.stringContaining("no Swiss with that id") });
  });

  it("gives Lichess's own ranks once the Swiss is finished", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info(), rows);
    expect(await standingsFor(w.store, lichess)).toEqual({ ok: true, standings: rows });
    expect(lichess.calls).toEqual(["swiss FgUapYId", "standings FgUapYId"]);
  });

  it("explains a Lichess failure instead of crashing", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    expect(await standingsFor(w.store, new FakeLive(info(), rows, true))).toMatchObject({ ok: false, error: expect.stringContaining("Lichess did not answer") });
  });

  it("does not build a bracket from a Swiss none of the players entered", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const strangers: StandingRow[] = [{ rank: 1, username: "someone-else", points: 2 }];
    expect(await standingsFor(w.store, new FakeLive(info(), strangers))).toMatchObject({
      ok: false,
      error: expect.stringContaining("None of the checked-in players"),
    });
  });

  it("matches players to the Swiss whatever the capitals", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const shouting: StandingRow[] = [{ rank: 1, username: "p05", points: 5 }];
    expect(await standingsFor(w.store, new FakeLive(info(), shouting))).toEqual({ ok: true, standings: shouting });
  });

  it("does not build a bracket from empty standings", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    expect(await standingsFor(w.store, new FakeLive(info(), []))).toMatchObject({ ok: false });
  });
});

describe("the Swiss on the pages", () => {
  /** 20 players: P01 is rank 1 down to P20, each a point apart. */
  const table: StandingRow[] = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, username: `P${String(i + 1).padStart(2, "0")}`, points: 20 - i }));

  it("shows nothing for a straight knockout, and does not ask Lichess", async () => {
    const w = swissWorld();
    w.store.registrations = w.store.registrations.slice(0, 8);
    const lichess = new FakeLive(info(), table);
    expect(await swissStandings(w.store, lichess, new SwissFeed(lichess))).toEqual({ kind: "none" });
    expect(lichess.calls).toEqual([]);
  });

  it("asks for a Swiss to be chosen on the real Lichess", async () => {
    const w = swissWorld();
    const lichess = new FakeLive(info(), table);
    expect(await swissStandings(w.store, lichess, new SwissFeed(lichess))).toEqual({ kind: "choose" });
    expect(lichess.calls).toEqual([]);
  });

  it("reads a Swiss that is still being played, and cuts it at the top 16 of 20", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info({ status: "started", round: 3, ongoing: 4 }), table);
    const result = await swissStandings(w.store, lichess, new SwissFeed(lichess));
    expect(result).toMatchObject({ kind: "table", name: "Castle Connect Swiss", progress: "Round 3 of 5, 4 games still being played", late: null });
    if (result.kind !== "table") return;
    expect(result.view.places).toBe(16);
    expect(result.view.finished).toBe(false);
    expect(result.view.rows).toHaveLength(20);
    expect(result.view.rows.filter((r) => r.inside)).toHaveLength(16);
    expect(result.readAt).toBeInstanceOf(Date);
  });

  it("says what is decided once the Swiss is finished", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info(), table);
    const result = await swissStandings(w.store, lichess, new SwissFeed(lichess));
    if (result.kind !== "table") throw new Error("expected a table");
    expect(result.view.finished).toBe(true);
    expect(result.view.rows.map((r) => r.fate).slice(14, 18)).toEqual(["through", "through", "out", "out"]);
  });

  it("leaves out anyone in the Swiss on Lichess who is not in the tournament", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info(), [{ rank: 1, username: "stranger", points: 99 }, { rank: 2, username: "p05", points: 5 }, { rank: 3, username: "P01", points: 4 }]);
    const result = await swissStandings(w.store, lichess, new SwissFeed(lichess));
    if (result.kind !== "table") throw new Error("expected a table");
    expect(result.view.rows.map((r) => r.username)).toEqual(["p05", "P01"]);
  });

  it("says so when Lichess cannot be asked and nothing was read before", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info(), table, true);
    expect(await swissStandings(w.store, lichess, new SwissFeed(lichess))).toMatchObject({ kind: "unavailable", error: expect.stringContaining("Lichess did not answer") });
  });

  it("shows the earlier reading, marked late, when Lichess goes quiet", async () => {
    const w = swissWorld();
    w.store.tournament.swissId = "FgUapYId";
    const lichess = new FakeLive(info({ status: "started", round: 2 }), table);
    let now = 0;
    const feed = new SwissFeed(lichess, { fresh: 1000, finished: 1000, rateLimited: 1000, failed: 1000 }, () => now);
    await swissStandings(w.store, lichess, feed);
    now = 5000;
    lichess.broken = true;
    const result = await swissStandings(w.store, lichess, feed);
    expect(result).toMatchObject({ kind: "table", late: expect.stringContaining("Lichess did not answer") });
  });

  it("shows the standings kept with the bracket once it is built, without asking Lichess", async () => {
    const w = setup(); // built from 20 players, 8 qualifiers
    const lichess = new FakeLive(info(), table);
    const result = await swissStandings(w.store, lichess, new SwissFeed(lichess));
    expect(result).toMatchObject({ kind: "table", name: null, progress: "Final standings", readAt: null, late: null });
    if (result.kind !== "table") return;
    expect(result.view.places).toBe(8);
    expect(result.view.rows).toHaveLength(20);
    expect(result.view.rows.filter((r) => r.inside).map((r) => r.username)).toEqual(w.store.tournament.qualifiers!.map((q) => q.username));
    expect(lichess.calls).toEqual([]);
  });

  it("drops players ranked above the last qualifier who did not qualify, from the kept standings", async () => {
    const w = setup();
    // Someone who was in the Swiss on Lichess but not in the tournament came first.
    w.store.tournament.swiss = [{ rank: 1, username: "stranger", points: 9 }, ...w.store.tournament.swiss!.map((s) => ({ ...s, rank: s.rank + 1 }))];
    const lichess = new FakeLive(info(), table);
    const result = await swissStandings(w.store, lichess, new SwissFeed(lichess));
    if (result.kind !== "table") throw new Error("expected a table");
    expect(result.view.rows.map((r) => r.username)).not.toContain("stranger");
    expect(result.view.rows.filter((r) => r.inside)).toHaveLength(8);
  });

  it("shows invented standings on the stand-in Lichess, with no Swiss chosen", async () => {
    const w = swissWorld();
    const mock = new MockLichess();
    const result = await swissStandings(w.store, mock, new SwissFeed(mock));
    expect(result).toMatchObject({ kind: "table", name: "Simulated Swiss" });
    if (result.kind !== "table") return;
    expect(result.view.rows).toHaveLength(20);
  });
});
