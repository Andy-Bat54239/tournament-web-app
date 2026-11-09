import { describe, expect, it } from "vitest";
import {
  FIRST_LOCK_MS,
  FORGET_AFTER_MS,
  FREE_TRIES,
  LONGEST_LOCK_MS,
  MOST_SOURCES,
  afterFailure,
  afterSuccess,
  lockAfter,
  lockedFor,
  waitText,
  type Attempts,
} from "./login-throttle";

const NOW = new Date(Date.UTC(2026, 10, 9, 12, 0, 0));
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** Guess wrongly `n` times in a row from one source, one second apart. */
function wrong(n: number, key = "a"): { attempts: Attempts; lockedMs: number; at: Date } {
  let attempts: Attempts = {};
  let lockedMs = 0;
  let at = NOW;
  for (let i = 0; i < n; i++) {
    at = later(i * 1000);
    ({ attempts, lockedMs } = afterFailure(attempts, key, at));
  }
  return { attempts, lockedMs, at };
}

describe("the lock earned by wrong guesses", () => {
  it("lets the first few through, because people mistype", () => {
    for (let n = 1; n <= FREE_TRIES; n++) expect(lockAfter(n)).toBe(0);
  });

  it("then doubles from 30 seconds up to a quarter of an hour", () => {
    const locks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].map((i) => lockAfter(FREE_TRIES + i));
    expect(locks).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000, 900_000, 900_000, 900_000]);
    expect(locks[0]).toBe(FIRST_LOCK_MS);
    expect(Math.max(...locks)).toBe(LONGEST_LOCK_MS);
  });
});

describe("afterFailure and lockedFor", () => {
  it("does not lock anyone while the guesses are free", () => {
    const { attempts, lockedMs, at } = wrong(FREE_TRIES);
    expect(lockedMs).toBe(0);
    expect(lockedFor(attempts, "a", at)).toBe(0);
    expect(attempts.a.failures).toBe(FREE_TRIES);
  });

  it("locks on the next wrong guess, and the lock runs out", () => {
    const { attempts, lockedMs, at } = wrong(FREE_TRIES + 1);
    expect(lockedMs).toBe(FIRST_LOCK_MS);
    expect(lockedFor(attempts, "a", at)).toBe(FIRST_LOCK_MS);
    expect(lockedFor(attempts, "a", new Date(at.getTime() + 10_000))).toBe(20_000);
    expect(lockedFor(attempts, "a", new Date(at.getTime() + FIRST_LOCK_MS))).toBe(0);
  });

  it("locks only the source that guessed", () => {
    const { attempts, at } = wrong(FREE_TRIES + 1, "stranger");
    expect(lockedFor(attempts, "stranger", at)).toBeGreaterThan(0);
    expect(lockedFor(attempts, "the-real-admin", at)).toBe(0);
  });

  it("does not change what it is given", () => {
    const before: Attempts = {};
    afterFailure(before, "a", NOW);
    expect(before).toEqual({});
  });
});

describe("afterSuccess", () => {
  it("starts that source again from nothing", () => {
    const { attempts } = wrong(FREE_TRIES + 3);
    expect(afterSuccess(attempts, "a")).toEqual({});
  });

  it("leaves other sources alone, and returns the same object when there is nothing to clear", () => {
    const { attempts } = wrong(2, "b");
    expect(afterSuccess(attempts, "a")).toBe(attempts);
    expect(Object.keys(afterSuccess({ ...attempts, a: attempts.b }, "a"))).toEqual(["b"]);
  });
});

describe("forgetting", () => {
  it("drops a source that has been quiet for a day", () => {
    let attempts: Attempts = afterFailure({}, "old", NOW).attempts;
    attempts = afterFailure(attempts, "new", later(FORGET_AFTER_MS + 1000)).attempts;
    expect(Object.keys(attempts)).toEqual(["new"]);
  });

  it("keeps the most recent sources when too many arrive", () => {
    let attempts: Attempts = {};
    for (let i = 0; i < MOST_SOURCES + 50; i++) attempts = afterFailure(attempts, `k${i}`, later(i * 1000)).attempts;
    expect(Object.keys(attempts)).toHaveLength(MOST_SOURCES);
    expect(attempts[`k${MOST_SOURCES + 49}`]).toBeDefined();
    expect(attempts.k0).toBeUndefined();
  });
});

describe("waitText", () => {
  it("says seconds, then minutes, rounded up", () => {
    expect(waitText(1)).toBe("1 second");
    expect(waitText(30_000)).toBe("30 seconds");
    expect(waitText(60_000)).toBe("1 minute");
    expect(waitText(61_000)).toBe("2 minutes");
    expect(waitText(LONGEST_LOCK_MS)).toBe("15 minutes");
  });
});
