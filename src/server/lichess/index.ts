import "server-only";
import { MockLichess } from "./mock";
import type { LichessClient } from "./types";

const client: LichessClient = new MockLichess();

/** The real Lichess client replaces the mock here once the API checks are done. */
export function getLichess(): LichessClient {
  return client;
}

export type { LichessClient, LichessProfile, StandingRow } from "./types";
