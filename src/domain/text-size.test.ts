import { describe, expect, it } from "vitest";
import { LEAST_ROOM, NORMAL_SIZE, TEXT_SIZES, largestSize, savedSizeScript, sizeFrom, stepSize } from "./text-size";

describe("sizeFrom", () => {
  it("reads a listed size as it is", () => {
    expect(sizeFrom("1.3")).toBe(1.3);
    expect(sizeFrom("0.5")).toBe(0.5);
  });

  it("snaps something between two sizes to the closer one", () => {
    expect(sizeFrom("1.2")).toBe(1.15);
    expect(sizeFrom("1.25")).toBe(1.3);
    expect(sizeFrom("9")).toBe(2);
    expect(sizeFrom("-3")).toBe(0.5);
  });

  it("falls back to normal for anything that is not a number", () => {
    for (const raw of [null, undefined, "", "big", "NaN"]) expect(sizeFrom(raw)).toBe(NORMAL_SIZE);
  });

  it("lists normal, in order", () => {
    expect(TEXT_SIZES).toContain(NORMAL_SIZE);
    expect([...TEXT_SIZES]).toEqual([...TEXT_SIZES].sort((a, b) => a - b));
  });
});

describe("largestSize", () => {
  it("leaves at least the least room, however the screen is scaled", () => {
    for (const [width, step] of [
      [1280, 1],
      [1366, 1],
      [1920, 1.35],
      [2560, 1.8],
      [3840, 2.7],
    ]) {
      const largest = largestSize(width, step);
      expect(width / (step * largest)).toBeGreaterThanOrEqual(LEAST_ROOM);
      // And the next size up would leave too little.
      const listed: readonly number[] = TEXT_SIZES;
      const next = listed[listed.indexOf(largest) + 1];
      if (next !== undefined) expect(width / (step * next)).toBeLessThan(LEAST_ROOM);
    }
  });

  it("gives a 1080p projector one size above normal, and a 4K television one too", () => {
    expect(largestSize(1920, 1.35)).toBe(1.3);
    expect(largestSize(3840, 2.7)).toBe(1.3);
  });

  it("gives a small laptop a little room to grow", () => {
    expect(largestSize(1280, 1)).toBe(1.15);
  });

  it("still offers the smallest size when nothing fits, and copes with a step it cannot read", () => {
    expect(largestSize(400, 1)).toBe(TEXT_SIZES[0]);
    expect(largestSize(1920, Number.NaN)).toBe(largestSize(1920, 1));
    expect(largestSize(1920, 0)).toBe(largestSize(1920, 1));
  });
});

describe("stepSize", () => {
  it("moves one size at a time", () => {
    expect(stepSize(1, "larger", 2)).toBe(1.15);
    expect(stepSize(1, "smaller", 2)).toBe(0.9);
  });

  it("stops at the smallest size and at the largest this screen has room for", () => {
    expect(stepSize(0.5, "smaller", 2)).toBe(0.5);
    expect(stepSize(1.3, "larger", 1.3)).toBe(1.3);
    expect(stepSize(2, "larger", 2)).toBe(2);
  });

  it("brings a size that is too big for this screen down to the limit when Smaller or Larger is pressed", () => {
    expect(stepSize(1.75, "larger", 1.3)).toBe(1.3);
    expect(stepSize(1.75, "smaller", 1.3)).toBe(1.3);
  });

  it("takes a size that is not on the list to the nearest one first", () => {
    expect(stepSize(1.2, "larger", 2)).toBe(1.3);
  });
});

describe("savedSizeScript", () => {
  /** Runs the script against a fake page and storage, the way the browser would. */
  function run(saved: string | null, storageThrows = false) {
    const set: Record<string, string> = {};
    const fake = {
      localStorage: {
        getItem: () => {
          if (storageThrows) throw new Error("blocked");
          return saved;
        },
      },
      document: { documentElement: { style: { setProperty: (name: string, value: string) => (set[name] = value) } } },
    };
    new Function("localStorage", "document", savedSizeScript())(fake.localStorage, fake.document);
    return set;
  }

  it("puts a saved size on the page", () => {
    expect(run("1.3")).toEqual({ "--size": "1.3" });
  });

  it("does nothing when nothing, or something unusable, was saved", () => {
    expect(run(null)).toEqual({});
    expect(run("huge")).toEqual({});
    expect(run("40")).toEqual({});
    expect(run("0.1")).toEqual({});
  });

  it("does not throw when storage is blocked", () => {
    expect(run("1.3", true)).toEqual({});
  });
});
