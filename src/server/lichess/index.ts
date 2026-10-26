import "server-only";
import { HttpLichess } from "./http";
import { MockLichess } from "./mock";
import type { LichessClient } from "./types";

/**
 * Which Lichess the app talks to:
 *   LICHESS_MODE=live   the real Lichess. Needs LICHESS_SERVICE_TOKEN, a personal access token with the
 *                       challenge:read and challenge:write scopes, for the account that creates game links.
 *   otherwise           the mock, which is refused in production unless ALLOW_MOCK_LOGIN is "true".
 */

const holder = globalThis as unknown as { __castleConnectLichess?: LichessClient };

export function getLichess(): LichessClient {
  if (holder.__castleConnectLichess) return holder.__castleConnectLichess;

  if (process.env.LICHESS_MODE === "live") {
    const token = process.env.LICHESS_SERVICE_TOKEN;
    if (!token) throw new Error("LICHESS_MODE=live needs LICHESS_SERVICE_TOKEN.");
    holder.__castleConnectLichess = new HttpLichess({ token });
  } else {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_LOGIN !== "true") {
      throw new Error("Lichess is not connected. Set LICHESS_MODE=live and LICHESS_SERVICE_TOKEN.");
    }
    holder.__castleConnectLichess = new MockLichess();
  }
  return holder.__castleConnectLichess;
}

/** The mock, for the development simulator. Null when talking to the real Lichess. */
export function getMockLichess(): MockLichess | null {
  const client = getLichess();
  return client instanceof MockLichess ? client : null;
}

export { LichessError, LichessRateLimited } from "./types";
export type { GameLink, LichessClient, LichessGame, LichessProfile, LinkRequest, StandingRow } from "./types";
