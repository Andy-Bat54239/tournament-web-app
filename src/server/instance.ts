import "server-only";
import { PRESETS } from "@/domain/permissions";
import type { Registration } from "@/domain/registration";
import { HARD_CAP } from "@/domain/registration";
import { getSql } from "./db/connect";
import { StateRepository } from "./db/repository";
import { getLichess } from "./lichess";
import { StoreProvider } from "./provider";
import type { PersistedState, Store } from "./store";
import { readOpenGames, type SyncReport } from "./sync";

/**
 * The one tournament this app runs, kept in Postgres (see StoreProvider and db/connect). Configure with:
 *   TOURNAMENT_START   ISO time with offset, default 2026-11-01T14:00:00+03:00
 *   TOURNAMENT_CAP     number of spots, 2 to 64, default 64
 *   SUPER_ADMIN        Lichess username of the super admin (Joel); defaults to "Joel" outside production
 *   SEED_DEMO          "true" or "false"; demo players and admins, on outside production by default
 *
 * TOURNAMENT_START, TOURNAMENT_CAP and SEED_DEMO only say how the tournament starts out, the first time the app
 * runs against an empty database. After that the saved tournament wins, and the start time is changed in the app.
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

function initialState(): PersistedState {
  const { startsAt, cap, seedDemo } = config();
  return {
    tournament: {
      name: "Castle Connect Sunday tournament",
      startsAt,
      cap,
      status: "open",
      scheduleChange: null,
      announcement: null,
      swissId: null,
      knockoutHeld: false,
      swiss: null,
      qualifiers: null,
      bracket: null,
      records: {},
      play: {},
    },
    registrations: seedDemo ? demoPlayers() : [],
    admins: seedDemo
      ? [
          { username: "Ruth_Ref", preset: "referee", grants: [...PRESETS.referee] },
          { username: "Dan_Desk", preset: "desk", grants: [...PRESETS.desk] },
        ]
      : [],
    audit: [],
  };
}

// Kept on globalThis so dev-server reloads and separate route bundles share one connection.
const holder = globalThis as unknown as { __castleConnectProvider?: Promise<StoreProvider> };

function provider(): Promise<StoreProvider> {
  holder.__castleConnectProvider ??= (async () => {
    const sql = await getSql();
    return new StoreProvider(new StateRepository<PersistedState>(sql), {
      superAdmin: config().superAdmin,
      initial: initialState,
      closeLink: (id) => getLichess().cancelLink(id),
    });
  })().catch((error) => {
    holder.__castleConnectProvider = undefined;
    throw error;
  });
  return holder.__castleConnectProvider;
}

/** The tournament as it is now, for showing. Changes made to the copy are not saved. */
export async function readStore(): Promise<Store> {
  return (await provider()).read();
}

/**
 * Changes the tournament and saves it. If somebody else saved at the same moment, `change` runs again on the
 * newer state, so it must only change the store it is given (and may be given twice).
 */
export async function updateStore<T>(change: (store: Store) => Promise<T> | T): Promise<T> {
  return (await provider()).update(change);
}

/** Reads the games that have a link out from Lichess and records what they say. See readOpenGames. */
export async function syncResults(): Promise<SyncReport> {
  return readOpenGames(await provider(), getLichess());
}
