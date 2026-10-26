import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everySoOften, startBackgroundSync, syncInterval } from "./background";

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { __castleConnectSyncLoop?: unknown }).__castleConnectSyncLoop;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("everySoOften", () => {
  it("runs the task on every tick, until stopped", async () => {
    const task = vi.fn(async () => {});
    const stop = everySoOften(task, 1000, () => {});
    await vi.advanceTimersByTimeAsync(3500);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("never runs the task twice at once: a tick that finds it still running is skipped", async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const stop = everySoOften(task, 1000, () => {});
    await vi.advanceTimersByTimeAsync(3500); // three ticks, but the first run has not finished
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a failed run and carries on", async () => {
    const task = vi.fn(async () => {
      throw new Error("database down");
    });
    const errors: unknown[] = [];
    const stop = everySoOften(task, 1000, (e) => errors.push(e));
    await vi.advanceTimersByTimeAsync(2500);
    expect(task).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2);
    stop();
  });
});

describe("syncInterval", () => {
  it("is 20 seconds unless set, and never under 5", () => {
    expect(syncInterval(undefined)).toBe(20_000);
    expect(syncInterval("")).toBe(20_000);
    expect(syncInterval("soon")).toBe(20_000);
    expect(syncInterval("-3")).toBe(20_000);
    expect(syncInterval("30")).toBe(30_000);
    expect(syncInterval("1")).toBe(5_000);
  });
});

describe("startBackgroundSync", () => {
  it("does nothing unless BACKGROUND_SYNC is true", async () => {
    const task = vi.fn(async () => {});
    expect(startBackgroundSync(task)).toBe(false);
    vi.stubEnv("BACKGROUND_SYNC", "yes");
    expect(startBackgroundSync(task)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).not.toHaveBeenCalled();
  });

  it("starts one loop, however many times it is asked", async () => {
    vi.stubEnv("BACKGROUND_SYNC", "true");
    vi.stubEnv("SYNC_EVERY_SECONDS", "10");
    const task = vi.fn(async () => {});
    expect(startBackgroundSync(task)).toBe(true);
    expect(startBackgroundSync(task)).toBe(false);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(task).toHaveBeenCalledTimes(3);
  });
});
