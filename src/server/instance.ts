import "server-only";
import { PRESETS } from "@/domain/permissions";
import type { Registration } from "@/domain/registration";
import { HARD_CAP } from "@/domain/registration";
import { Store, type TournamentState } from "./store";

/**
 * The one tournament this app runs, held in memory (see Store). Configure with:
 *   TOURNAMENT_START   ISO time with offset, default 2026-11-01T14:00:00+03:00
 *   TOURNAMENT_CAP     number of spots, 2 to 64, default 64
 *   SUPER_ADMIN        Lichess username of the super admin (Joel); defaults to "Joel" outside production
 *   SEED_DEMO          "true" or "false"; demo players and admins, on outside production by default
 */

const DEFAULT_START = "2026-11-01T14:00:00+03:00";

function config() {
  const production = process.env.NODE_ENV === "production";
  const start = new Date(process.env.TOURNAMENT_START ?? DEFAULT_START);
  const cap = Number(process.env.TOURNAMENT_CAP ?? HARD_CAP);
  return {
    startsAt: (Number.isNaN(start.getTime()) ? new Date(DEFAULT_START) : start).toISOString(),
    cap: Number.isInteger(cap) && cap >= 2 && cap <= HARD_CAP ? cap : HARD_CAP,
    superAdmin: process.env.SUPER_ADMIN ?? (production ? null : "Joel"),
    seedDemo: (process.env.SEED_DEMO ?? String(!production)) === "true",
  };
}

const FIRST_NAMES = ["Grace", "Ronald", "Brian", "Sarah", "Daniel", "Ivan", "Joan", "Kevin", "Timothy", "Patience"];

/** Invented players, so the sign-up and bracket pages have something to show. */
function demoPlayers(): Registration[] {
  return Array.from({ length: 41 }, (_, i) => {
    const username = FIRST_NAMES[i] ?? `Player_${String(i + 1).padStart(2, "0")}`;
    const joined = new Date(Date.UTC(2026, 9, 24, 8, i)).toISOString();
    return {
      username,
      rating: 900 + ((i * 137) % 1100),
      whatsapp: `+2567000000${String(i).padStart(2, "0")}`,
      consentAt: joined,
      teamJoined: true,
      checkedIn: i < 36,
      status: "registered" as const,
      joinedAt: joined,
    };
  });
}

function createStore(): Store {
  const { startsAt, cap, superAdmin, seedDemo } = config();
  const tournament: TournamentState = {
    name: "Castle Connect Sunday tournament",
    startsAt,
    cap,
    status: "open",
    scheduleChange: null,
    announcement: null,
    swiss: null,
    qualifiers: null,
    bracket: null,
    records: {},
  };
  return new Store({
    tournament,
    superAdmin,
    registrations: seedDemo ? demoPlayers() : [],
    admins: seedDemo
      ? [
          { username: "Ruth_Ref", preset: "referee", grants: [...PRESETS.referee] },
          { username: "Dan_Desk", preset: "desk", grants: [...PRESETS.desk] },
        ]
      : [],
  });
}

// Kept on globalThis so dev-server reloads and separate route bundles share one store.
const holder = globalThis as unknown as { __castleConnectStore?: Store };

export function getStore(): Store {
  holder.__castleConnectStore ??= createStore();
  return holder.__castleConnectStore;
}
