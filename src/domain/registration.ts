/**
 * Sign-up, waitlist and check-in rules (brief, sections 6 and 7A-B).
 * Every function returns a new array; nothing here mutates its input.
 */

export type RegistrationStatus = "registered" | "waitlisted" | "withdrawn" | "removed";

export interface Registration {
  /** Lichess username, in the case Lichess reports it. */
  username: string;
  /** Lichess blitz rating when the player signed up. Null when new (provisional). */
  rating: number | null;
  /** Organizer-only. Never shown to other players. */
  whatsapp: string;
  /** ISO time the player accepted the rules and the WhatsApp consent wording. */
  consentAt: string;
  teamJoined: boolean;
  checkedIn: boolean;
  status: RegistrationStatus;
  /** ISO time. Orders the waitlist, first come first served. */
  joinedAt: string;
}

export interface SignUpInput {
  username: string;
  rating: number | null;
  whatsapp: string;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export const HARD_CAP = 64;

/** What a Lichess username looks like: letters, numbers, _ and -. */
export const LICHESS_USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

export function sameUser(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function findRegistration(
  regs: readonly Registration[],
  username: string,
): Registration | undefined {
  return regs.find((r) => sameUser(r.username, username));
}

const inField = (r: Registration) => r.status === "registered" || r.status === "waitlisted";

export function registeredCount(regs: readonly Registration[]): number {
  return regs.filter((r) => r.status === "registered").length;
}

function byJoinedAt(a: Registration, b: Registration): number {
  return a.joinedAt.localeCompare(b.joinedAt);
}

/** 1-based spot among registered players, in sign-up order. */
export function spotNumber(regs: readonly Registration[], username: string): number | null {
  const spots = regs.filter((r) => r.status === "registered").sort(byJoinedAt);
  const i = spots.findIndex((r) => sameUser(r.username, username));
  return i === -1 ? null : i + 1;
}

/** 1-based place on the waitlist. */
export function waitlistPosition(regs: readonly Registration[], username: string): number | null {
  const queue = regs.filter((r) => r.status === "waitlisted").sort(byJoinedAt);
  const i = queue.findIndex((r) => sameUser(r.username, username));
  return i === -1 ? null : i + 1;
}

export interface RosterCounts {
  checkedIn: number;
  notCheckedIn: number;
  waitlist: number;
}

export function rosterCounts(regs: readonly Registration[]): RosterCounts {
  const registered = regs.filter((r) => r.status === "registered");
  return {
    checkedIn: registered.filter((r) => r.checkedIn).length,
    notCheckedIn: registered.filter((r) => !r.checkedIn).length,
    waitlist: regs.filter((r) => r.status === "waitlisted").length,
  };
}

/** Moves waitlisted players into any free spots, first come first served. */
function fillSpots(
  regs: readonly Registration[],
  cap: number,
): { regs: Registration[]; promoted: string[] } {
  const free = Math.max(0, cap - registeredCount(regs));
  const promoted = regs
    .filter((r) => r.status === "waitlisted")
    .sort(byJoinedAt)
    .slice(0, free)
    .map((r) => r.username);
  return {
    regs: regs.map((r) =>
      promoted.includes(r.username) ? { ...r, status: "registered" as const } : r,
    ),
    promoted,
  };
}

export function register(
  regs: readonly Registration[],
  input: SignUpInput,
  cap: number,
  now: Date,
): Result<{
  regs: Registration[];
  status: "registered" | "waitlisted";
  position: number;
}> {
  const existing = findRegistration(regs, input.username);
  if (existing && inField(existing)) return { ok: false, error: "You’re already signed up." };
  if (existing?.status === "removed") {
    return { ok: false, error: "You were removed from this tournament. Please ask an organizer." };
  }

  const status = registeredCount(regs) < cap ? "registered" : "waitlisted";
  const entry: Registration = {
    username: input.username,
    rating: input.rating,
    whatsapp: input.whatsapp,
    consentAt: now.toISOString(),
    teamJoined: false,
    checkedIn: false,
    status,
    joinedAt: now.toISOString(),
  };
  // A player who withdrew and comes back rejoins at the back of the line.
  const next = [...regs.filter((r) => r !== existing), entry];
  const position =
    (status === "registered"
      ? spotNumber(next, input.username)
      : waitlistPosition(next, input.username)) ?? 0;
  return { ok: true, regs: next, status, position };
}

export function withdraw(
  regs: readonly Registration[],
  username: string,
  cap: number,
): Result<{ regs: Registration[]; promoted: string[] }> {
  const existing = findRegistration(regs, username);
  if (!existing || !inField(existing)) return { ok: false, error: "You’re not signed up." };
  const next = regs.map((r) =>
    r === existing ? { ...r, status: "withdrawn" as const, checkedIn: false } : r,
  );
  return { ok: true, ...fillSpots(next, cap) };
}

export function checkIn(
  regs: readonly Registration[],
  username: string,
): Result<{ regs: Registration[] }> {
  const existing = findRegistration(regs, username);
  if (!existing || !inField(existing)) return { ok: false, error: "You’re not signed up." };
  return { ok: true, regs: regs.map((r) => (r === existing ? { ...r, checkedIn: true } : r)) };
}

export function joinTeam(
  regs: readonly Registration[],
  username: string,
): Result<{ regs: Registration[] }> {
  const existing = findRegistration(regs, username);
  if (!existing || !inField(existing)) return { ok: false, error: "You’re not signed up." };
  return { ok: true, regs: regs.map((r) => (r === existing ? { ...r, teamJoined: true } : r)) };
}

/**
 * Players who did not check in are removed and the waitlist fills their places.
 * Promoted players keep any check-in they already made; the desk checks in the rest.
 */
export function removeNoShows(
  regs: readonly Registration[],
  cap: number,
): { regs: Registration[]; removed: string[]; promoted: string[] } {
  const removed = regs
    .filter((r) => r.status === "registered" && !r.checkedIn)
    .map((r) => r.username);
  const next = regs.map((r) =>
    removed.includes(r.username) ? { ...r, status: "removed" as const } : r,
  );
  return { ...fillSpots(next, cap), removed };
}

/** Registered players only, in sign-up order. */
export function field(regs: readonly Registration[]): Registration[] {
  return regs.filter((r) => r.status === "registered").sort(byJoinedAt);
}
