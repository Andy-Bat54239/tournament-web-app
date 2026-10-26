import { PRESETS } from "@/domain/permissions";
import type { Registration } from "@/domain/registration";
import { MockLichess } from "@/server/lichess/mock";
import { Store } from "@/server/store";

// Everything is relative to now, because the mock decides a link has expired using the real clock.
export const T0 = new Date();
export const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

export function player(i: number): Registration {
  const joined = new Date(Date.UTC(2026, 9, 24, 8, i)).toISOString();
  return {
    username: `P${String(i + 1).padStart(2, "0")}`,
    rating: 2000 - i * 10,
    whatsapp: "+256700000000",
    consentAt: joined,
    teamJoined: true,
    checkedIn: true,
    status: "registered",
    joinedAt: joined,
  };
}

/**
 * An 8-player bracket. Seeds 1 to 8 are P01 to P08, so the first round is P01 v P08, P04 v P05, P02 v P07 and
 * P03 v P06. Joel is the super admin, Ruth a referee and Dan the check-in desk.
 */
export function setup() {
  const store = new Store({
    superAdmin: "Joel",
    registrations: Array.from({ length: 20 }, (_, i) => player(i)),
    admins: [
      { username: "Ruth", preset: "referee", grants: [...PRESETS.referee] },
      { username: "Dan", preset: "desk", grants: [...PRESETS.desk] },
    ],
    tournament: {
      name: "Test",
      startsAt: at(0).toISOString(),
      cap: 64,
      status: "open",
      scheduleChange: null,
      announcement: null,
      swiss: null,
      qualifiers: null,
      bracket: null,
      records: {},
      play: {},
    },
  });
  const standings = store.registrations.map((r, i) => ({ rank: i + 1, username: r.username, points: 5 - i / 10 }));
  const built = store.buildBracket("Joel", standings, { qualifiers: 8 }, T0);
  if (!built.ok) throw new Error(built.error);
  return { store, lichess: new MockLichess() };
}

export type World = ReturnType<typeof setup>;
