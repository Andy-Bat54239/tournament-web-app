import { describe, expect, it } from "vitest";
import {
  checkIn,
  field,
  joinTeam,
  register,
  registeredCount,
  removeNoShows,
  rosterCounts,
  spotNumber,
  waitlistPosition,
  withdraw,
  type Registration,
} from "./registration";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 26, 10, minute));

function signUpAll(names: string[], cap: number): Registration[] {
  let regs: Registration[] = [];
  names.forEach((username, i) => {
    const r = register(regs, { username, rating: 1500, whatsapp: "+256772000000" }, cap, at(i));
    if (!r.ok) throw new Error(r.error);
    regs = r.regs;
  });
  return regs;
}

describe("register", () => {
  it("gives spots in order, then the waitlist once the cap is reached", () => {
    const regs = signUpAll(["Ann", "Ben", "Cat", "Dan", "Eve"], 3);
    expect(regs.map((r) => r.status)).toEqual([
      "registered",
      "registered",
      "registered",
      "waitlisted",
      "waitlisted",
    ]);
    expect(spotNumber(regs, "Cat")).toBe(3);
    expect(waitlistPosition(regs, "Dan")).toBe(1);
    expect(waitlistPosition(regs, "Eve")).toBe(2);
    expect(registeredCount(regs)).toBe(3);
  });

  it("reports the status and position of the new sign-up", () => {
    const regs = signUpAll(["Ann", "Ben"], 2);
    const full = register(regs, { username: "Cat", rating: null, whatsapp: "+256772000001" }, 2, at(9));
    expect(full).toMatchObject({ ok: true, status: "waitlisted", position: 1 });
  });

  it("records consent and starts unchecked", () => {
    const [ann] = signUpAll(["Ann"], 64);
    expect(ann).toMatchObject({
      consentAt: at(0).toISOString(),
      checkedIn: false,
      teamJoined: false,
      status: "registered",
    });
  });

  it("stops duplicate sign-ups, ignoring case", () => {
    const regs = signUpAll(["Ann"], 64);
    const again = register(regs, { username: "ANN", rating: 1, whatsapp: "x" }, 64, at(5));
    expect(again).toEqual({ ok: false, error: "You’re already signed up." });
  });

  it("does not let a removed player back in", () => {
    const regs = signUpAll(["Ann", "Ben"], 64);
    const { regs: after } = removeNoShows(regs, 64);
    const again = register(after, { username: "Ann", rating: 1, whatsapp: "x" }, 64, at(5));
    expect(again.ok).toBe(false);
  });
});

describe("withdraw", () => {
  it("promotes the first player on the waitlist", () => {
    const regs = signUpAll(["Ann", "Ben", "Cat", "Dan", "Eve"], 3);
    const result = withdraw(regs, "Ben", 3);
    if (!result.ok) throw new Error(result.error);
    expect(result.promoted).toEqual(["Dan"]);
    expect(field(result.regs).map((r) => r.username)).toEqual(["Ann", "Cat", "Dan"]);
    expect(waitlistPosition(result.regs, "Eve")).toBe(1);
  });

  it("lets a player who withdrew sign up again, at the back of the line", () => {
    const regs = signUpAll(["Ann", "Ben"], 2);
    const out = withdraw(regs, "Ann", 2);
    if (!out.ok) throw new Error(out.error);
    const filled = register(out.regs, { username: "Cat", rating: 1, whatsapp: "x" }, 2, at(5));
    if (!filled.ok) throw new Error(filled.error);
    const back = register(filled.regs, { username: "Ann", rating: 1, whatsapp: "x" }, 2, at(6));
    expect(back).toMatchObject({ ok: true, status: "waitlisted", position: 1 });
  });

  it("errors when the player is not signed up", () => {
    expect(withdraw([], "Zed", 64)).toEqual({ ok: false, error: "You’re not signed up." });
  });
});

describe("check-in", () => {
  it("marks a player as checked in", () => {
    const regs = signUpAll(["Ann", "Ben"], 64);
    const result = checkIn(regs, "ben");
    if (!result.ok) throw new Error(result.error);
    expect(rosterCounts(result.regs)).toEqual({ checkedIn: 1, notCheckedIn: 1, waitlist: 0 });
  });

  it("removes players who did not check in and fills their places from the waitlist", () => {
    let regs = signUpAll(["Ann", "Ben", "Cat", "Dan", "Eve"], 3);
    const checked = checkIn(regs, "Ann");
    if (!checked.ok) throw new Error(checked.error);
    regs = checked.regs;

    const result = removeNoShows(regs, 3);
    expect(result.removed).toEqual(["Ben", "Cat"]);
    expect(result.promoted).toEqual(["Dan", "Eve"]);
    expect(field(result.regs).map((r) => r.username)).toEqual(["Ann", "Dan", "Eve"]);
    // Promoted players still need to be checked in by the desk.
    expect(rosterCounts(result.regs)).toEqual({ checkedIn: 1, notCheckedIn: 2, waitlist: 0 });
  });

  it("keeps a check-in made while on the waitlist", () => {
    let regs = signUpAll(["Ann", "Ben"], 1);
    const checked = checkIn(regs, "Ben");
    if (!checked.ok) throw new Error(checked.error);
    regs = checked.regs;
    const out = withdraw(regs, "Ann", 1);
    if (!out.ok) throw new Error(out.error);
    expect(rosterCounts(out.regs)).toEqual({ checkedIn: 1, notCheckedIn: 0, waitlist: 0 });
  });

  it("only works for people who signed up", () => {
    expect(checkIn([], "Zed").ok).toBe(false);
  });
});

describe("joinTeam", () => {
  it("records that the player joined the Lichess team", () => {
    const result = joinTeam(signUpAll(["Ann"], 64), "Ann");
    if (!result.ok) throw new Error(result.error);
    expect(result.regs[0].teamJoined).toBe(true);
  });
});
