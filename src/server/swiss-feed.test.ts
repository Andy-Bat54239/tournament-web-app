import { beforeEach, describe, expect, it } from "vitest";
import { MockLichess } from "./lichess/mock";
import { LichessError, LichessRateLimited, type StandingRow, type SwissInfo } from "./lichess/types";
import { LIVE_TIMES, MOCK_TIMES, SwissFeed } from "./swiss-feed";

const swiss = (over: Partial<SwissInfo> = {}): SwissInfo => ({
  id: "AbCdEfGh",
  name: "Sunday Swiss",
  status: "started",
  round: 2,
  rounds: 5,
  players: 3,
  ongoing: 1,
  ...over,
});

const standings: StandingRow[] = [
  { rank: 1, username: "Ann", points: 2 },
  { rank: 2, username: "Bob", points: 1 },
  { rank: 3, username: "Cy", points: 0 },
];

/** A Lichess that counts how often it is asked, and answers or fails as told. */
class FakeLichess extends MockLichess {
  override readonly live = true;
  info: SwissInfo | null = swiss();
  failure: Error | null = null;
  asked = { swiss: 0, standings: 0 };
  slow: Promise<void> | null = null;

  override async getSwiss(): Promise<SwissInfo | null> {
    this.asked.swiss++;
    await this.slow;
    if (this.failure) throw this.failure;
    return this.info;
  }

  override async getSwissStandings(): Promise<StandingRow[]> {
    this.asked.standings++;
    return standings;
  }
}

let lichess: FakeLichess;
let now: number;
const feed = (times = LIVE_TIMES) => new SwissFeed(lichess, times, () => now);

beforeEach(() => {
  lichess = new FakeLichess();
  now = Date.parse("2026-11-01T11:30:00Z");
});

describe("a running Swiss", () => {
  it("reads the Swiss and its standings", async () => {
    const read = await feed().read("AbCdEfGh");
    expect(read).toMatchObject({ ok: true, late: null });
    if (!read.ok) return;
    expect(read.reading.info.name).toBe("Sunday Swiss");
    expect(read.reading.standings).toEqual(standings);
    expect(read.reading.readAt).toEqual(new Date(now));
  });

  it("uses the last reading for a few seconds, however many ask", async () => {
    const f = feed();
    for (let i = 0; i < 50; i++) await f.read("AbCdEfGh");
    now += LIVE_TIMES.fresh - 1;
    await f.read("AbCdEfGh");
    expect(lichess.asked).toEqual({ swiss: 1, standings: 1 });
  });

  it("asks again once the reading is old", async () => {
    const f = feed();
    await f.read("AbCdEfGh");
    now += LIVE_TIMES.fresh;
    lichess.info = swiss({ round: 3 });
    const read = await f.read("AbCdEfGh");
    expect(lichess.asked).toEqual({ swiss: 2, standings: 2 });
    expect(read.ok && read.reading.info.round).toBe(3);
  });

  it("gives everyone who asks during a read that same read", async () => {
    let release!: () => void;
    lichess.slow = new Promise<void>((resolve) => (release = resolve));
    const f = feed();
    const readers = Array.from({ length: 30 }, () => f.read("AbCdEfGh"));
    release();
    const results = await Promise.all(readers);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(lichess.asked).toEqual({ swiss: 1, standings: 1 });
  });

  it("keeps a reading for each Swiss", async () => {
    const f = feed();
    await f.read("AbCdEfGh");
    await f.read("ZyXwVuTs");
    expect(lichess.asked.swiss).toBe(2);
  });
});

describe("a Swiss that has not started or has finished", () => {
  it("does not ask for standings before the first round", async () => {
    lichess.info = swiss({ status: "created", round: 0 });
    const read = await feed().read("AbCdEfGh");
    expect(read.ok && read.reading.standings).toEqual([]);
    expect(lichess.asked).toEqual({ swiss: 1, standings: 0 });
  });

  it("keeps a finished Swiss longer, because it no longer changes", async () => {
    lichess.info = swiss({ status: "finished", round: 5, ongoing: 0 });
    const f = feed();
    await f.read("AbCdEfGh");
    now += LIVE_TIMES.fresh * 5;
    await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(1);
    now += LIVE_TIMES.finished;
    await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(2);
  });
});

describe("when Lichess cannot be asked", () => {
  it("says so when there is nothing earlier to show", async () => {
    lichess.failure = new LichessError("HTTP 500");
    const read = await feed().read("AbCdEfGh");
    expect(read).toEqual({ ok: false, error: "Lichess did not answer as expected. Try again in a moment." });
  });

  it("leaves Lichess alone for a while after a failure, then tries again", async () => {
    lichess.failure = new Error("offline");
    const f = feed();
    for (let i = 0; i < 20; i++) await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(1);

    now += LIVE_TIMES.failed;
    lichess.failure = null;
    const read = await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(2);
    expect(read).toMatchObject({ ok: true, late: null });
  });

  it("shows the last good reading, marked late, rather than nothing", async () => {
    const f = feed();
    await f.read("AbCdEfGh");
    now += LIVE_TIMES.fresh;
    lichess.failure = new Error("offline");

    const read = await f.read("AbCdEfGh");
    expect(read).toMatchObject({ ok: true, late: "Could not reach Lichess. Try again in a moment." });
    if (!read.ok) return;
    expect(read.reading.standings).toEqual(standings);
    expect(read.reading.readAt).toEqual(new Date(Date.parse("2026-11-01T11:30:00Z")));
  });

  it("waits a full minute after Lichess says it is busy", async () => {
    const f = feed();
    await f.read("AbCdEfGh");
    now += LIVE_TIMES.fresh;
    lichess.failure = new LichessRateLimited("429");
    const first = await f.read("AbCdEfGh");
    expect(first).toMatchObject({ ok: true, late: "Lichess is busy. Try again in a minute." });

    lichess.failure = null;
    now += LIVE_TIMES.rateLimited - 1;
    await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(2);

    now += 1;
    expect(await f.read("AbCdEfGh")).toMatchObject({ ok: true, late: null });
    expect(lichess.asked.swiss).toBe(3);
  });

  it("says when Lichess has no such Swiss, and does not keep asking", async () => {
    lichess.info = null;
    const f = feed();
    const read = await f.read("AbCdEfGh");
    expect(read).toEqual({ ok: false, error: "Lichess has no Swiss with that id any more. Choose it again." });
    await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(1);
  });
});

describe("the stand-in Lichess", () => {
  it("is asked every time, so a change shows at once", async () => {
    const f = feed(MOCK_TIMES);
    await f.read("AbCdEfGh");
    await f.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(2);
  });

  it("is picked by whether Lichess is live, without being told", async () => {
    class Counting extends MockLichess {
      asked = 0;
      override async getSwiss(id: string) {
        this.asked++;
        return super.getSwiss(id);
      }
    }
    const mock = new Counting();
    const forMock = new SwissFeed(mock);
    await forMock.read("AbCdEfGh");
    await forMock.read("AbCdEfGh");
    expect(mock.asked).toBe(2);

    const forLive = new SwissFeed(lichess);
    await forLive.read("AbCdEfGh");
    await forLive.read("AbCdEfGh");
    expect(lichess.asked.swiss).toBe(1);
  });
});
