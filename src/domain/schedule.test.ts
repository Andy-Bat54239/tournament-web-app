import { describe, expect, it } from "vitest";
import {
  announcementText,
  canWithdraw,
  deriveSchedule,
  eastDate,
  eastTime,
  formatWhen,
  parseEast,
  phaseAt,
} from "./schedule";

const start = parseEast("2026-11-01", "14:00")!;

describe("parseEast", () => {
  it("reads a date and time as East Africa Time (UTC+3)", () => {
    expect(start.toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });

  it("round-trips back to East Africa Time, even across UTC midnight", () => {
    const early = parseEast("2026-11-01", "01:30")!;
    expect(early.toISOString()).toBe("2026-10-31T22:30:00.000Z");
    expect(eastDate(early)).toBe("2026-11-01");
    expect(eastTime(early)).toBe("01:30");
  });

  it("rejects things that are not a real date and time", () => {
    for (const [d, t] of [
      ["2026-02-31", "14:00"],
      ["2026-11-01", "25:00"],
      ["2026-11-01", "14:60"],
      ["1 Nov 2026", "14:00"],
      ["2026-11-01", "2pm"],
      ["", ""],
    ]) {
      expect(parseEast(d, t)).toBeNull();
    }
  });
});

describe("formatWhen", () => {
  it("writes the day and time in words", () => {
    expect(formatWhen(start)).toBe("Sunday 1 November, 14:00");
  });
});

describe("deriveSchedule", () => {
  it("works everything out from the start time", () => {
    const s = deriveSchedule(start);
    expect(eastTime(s.checkInOpensAt)).toBe("13:00");
    expect(eastTime(s.checkInClosesAt)).toBe("13:45");
    expect(s.signupClosesAt.toISOString()).toBe("2026-10-31T21:00:00.000Z"); // midnight, East Africa Time
    expect(s.withdrawDeadline).toEqual(s.checkInClosesAt);
  });

  it("recalculates when the start time moves", () => {
    const moved = deriveSchedule(parseEast("2026-11-08", "15:30")!);
    expect(eastDate(moved.signupClosesAt)).toBe("2026-11-08");
    expect(eastTime(moved.checkInOpensAt)).toBe("14:30");
  });

  it("never closes sign-ups after check-in opens", () => {
    const early = deriveSchedule(parseEast("2026-11-01", "00:30")!);
    expect(early.signupClosesAt).toEqual(early.checkInOpensAt);
  });
});

describe("phaseAt", () => {
  const s = deriveSchedule(start);
  const at = (date: string, time: string) => parseEast(date, time)!;

  it("moves through the day", () => {
    expect(phaseAt(s, at("2026-10-26", "09:00"))).toBe("signup_open");
    expect(phaseAt(s, at("2026-11-01", "00:00"))).toBe("signup_closed");
    expect(phaseAt(s, at("2026-11-01", "12:59"))).toBe("signup_closed");
    expect(phaseAt(s, at("2026-11-01", "13:00"))).toBe("check_in_open");
    expect(phaseAt(s, at("2026-11-01", "13:44"))).toBe("check_in_open");
    expect(phaseAt(s, at("2026-11-01", "13:45"))).toBe("check_in_closed");
    expect(phaseAt(s, at("2026-11-01", "14:00"))).toBe("started");
  });
});

describe("canWithdraw", () => {
  const s = deriveSchedule(start);
  const early = parseEast("2026-10-30", "10:00")!;
  const late = parseEast("2026-11-01", "13:50")!;

  it("is open until the deadline", () => {
    expect(canWithdraw(s, early, { bracketBuilt: false, scheduleChanged: false })).toBe(true);
    expect(canWithdraw(s, late, { bracketBuilt: false, scheduleChanged: false })).toBe(false);
  });

  it("reopens after a schedule change, but never once the bracket is built", () => {
    expect(canWithdraw(s, late, { bracketBuilt: false, scheduleChanged: true })).toBe(true);
    expect(canWithdraw(s, early, { bracketBuilt: true, scheduleChanged: true })).toBe(false);
  });
});

describe("announcementText", () => {
  const s = deriveSchedule(start);

  it("writes the community chat message", () => {
    expect(announcementText(s, false)).toBe(
      "Castle Connect tournament starts Sunday 1 November, 14:00 (East Africa Time). " +
        "Check-in opens at 13:00. Open the app to see your match.",
    );
  });

  it("flags a schedule update", () => {
    expect(announcementText(s, true)).toMatch(/^Schedule update: Castle Connect tournament starts/);
  });
});
