import type { LichessClient, LichessProfile, StandingRow } from "./types";

/** FNV-1a: a small stable hash, so the same username always gets the same fake data. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const KNOWN_RATINGS: Record<string, number> = { mercy_k: 1722 };
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

/** Stands in for Lichess in development. Everything here is invented. */
export class MockLichess implements LichessClient {
  async getProfile(username: string): Promise<LichessProfile | null> {
    if (!USERNAME.test(username)) return null;
    const h = hash(username);
    const known = KNOWN_RATINGS[username.toLowerCase()];
    const provisional = known === undefined && h % 9 === 0;
    return {
      username,
      blitzRating: provisional ? null : (known ?? 900 + (h % 1100)),
      provisional,
    };
  }

  async getSwissStandings({
    entrants,
  }: {
    swissId: string | null;
    entrants: string[];
  }): Promise<StandingRow[]> {
    const scored = entrants.map((username) => {
      const h = hash(username);
      return { username, points: ((h >>> 3) % 11) / 2, tiebreak: h };
    });
    scored.sort((a, b) => b.points - a.points || b.tiebreak - a.tiebreak);
    return scored.map(({ username, points }, i) => ({ rank: i + 1, username, points }));
  }
}
