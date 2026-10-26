import { describe, expect, it } from "vitest";
import { setup } from "@/test/fixtures";
import { MockLichess } from "./lichess/mock";
import { LichessError, type StandingRow, type SwissInfo } from "./lichess/types";
import { standingsFor } from "./swiss";

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
    private broken = false,
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
