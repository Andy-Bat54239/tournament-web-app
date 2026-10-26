/**
 * Everything time-based is worked out from the tournament start time, which
 * organizers can change (brief, sections 6 and 7G). Times are East Africa Time
 * (UTC+3, no daylight saving), so a fixed offset is safe.
 */

export const EAST_AFRICA_TIME = "Africa/Kampala";

const MINUTE = 60_000;
export const CHECK_IN_OPENS_BEFORE = 60 * MINUTE;
/** Assumption from the sample timeline: check-in closes 15 minutes before the start. */
export const CHECK_IN_CLOSES_BEFORE = 15 * MINUTE;
export const NO_SHOW_WINDOW = 3 * MINUTE;
export const GAME_TWO_WINDOW = 2 * MINUTE;

export interface Schedule {
  startsAt: Date;
  /** The night before: midnight at the start of the start date, East Africa Time. */
  signupClosesAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  /** Withdrawals are open until check-in closes (assumption to confirm). */
  withdrawDeadline: Date;
}

export type Phase =
  | "signup_open"
  | "signup_closed"
  | "check_in_open"
  | "check_in_closed"
  | "started";

function parts(d: Date): { date: string; time: string } {
  const get = new Intl.DateTimeFormat("en-CA", {
    timeZone: EAST_AFRICA_TIME,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (type: string) => get.find((p) => p.type === type)?.value ?? "";
  return { date: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}

/** "2026-11-01" and "14:00" as East Africa Time. Null if either is not a real date and time. */
export function parseEast(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects dates that roll over, such as 31 February.
  const back = parts(d);
  return back.date === date && back.time === time ? d : null;
}

export function eastDate(d: Date): string {
  return parts(d).date;
}

export function eastTime(d: Date): string {
  return parts(d).time;
}

/** "Sunday 1 November, 14:00" */
export function formatWhen(d: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: EAST_AFRICA_TIME,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(d)
    .replace(",", "");
  return `${day}, ${eastTime(d)}`;
}

export function deriveSchedule(startsAt: Date): Schedule {
  const checkInOpensAt = new Date(startsAt.getTime() - CHECK_IN_OPENS_BEFORE);
  const checkInClosesAt = new Date(startsAt.getTime() - CHECK_IN_CLOSES_BEFORE);
  const midnight = parseEast(eastDate(startsAt), "00:00") ?? startsAt;
  return {
    startsAt,
    // Never later than check-in opening, even for a very early start.
    signupClosesAt: midnight < checkInOpensAt ? midnight : checkInOpensAt,
    checkInOpensAt,
    checkInClosesAt,
    withdrawDeadline: checkInClosesAt,
  };
}

export function phaseAt(schedule: Schedule, now: Date): Phase {
  if (now < schedule.signupClosesAt) return "signup_open";
  if (now < schedule.checkInOpensAt) return "signup_closed";
  if (now < schedule.checkInClosesAt) return "check_in_open";
  if (now < schedule.startsAt) return "check_in_closed";
  return "started";
}

/**
 * Withdrawals close at the deadline or once the bracket is built. After a
 * schedule change, players who already signed up may still withdraw
 * (suggested in the brief).
 */
export function canWithdraw(
  schedule: Schedule,
  now: Date,
  opts: { bracketBuilt: boolean; scheduleChanged: boolean },
): boolean {
  if (opts.bracketBuilt) return false;
  return opts.scheduleChanged || now < schedule.withdrawDeadline;
}

/** Text for the community chat; the organizer picks the group and sends it. */
export function announcementText(schedule: Schedule, changed: boolean): string {
  return (
    (changed ? "Schedule update: " : "") +
    `Castle Connect tournament starts ${formatWhen(schedule.startsAt)} (East Africa Time). ` +
    `Check-in opens at ${eastTime(schedule.checkInOpensAt)}. Open the app to see your match.`
  );
}
