import type { GameLink, LichessClient, LichessGame, LichessProfile, LinkRequest, StandingRow, SwissInfo } from "./types";

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

export type SimulatedEvent = "join" | "white" | "black" | "draw" | "abort";

interface MockLink {
  request: LinkRequest;
  open: boolean;
}

/**
 * Stands in for Lichess in development. Everything here is invented. Links and games are kept in memory, and
 * `simulate` plays the part of the two players so every state of the match screen can be reached by hand.
 */
export class MockLichess implements LichessClient {
  readonly live = false;
  private readonly links = new Map<string, MockLink>();
  private readonly games = new Map<string, LichessGame>();
  private counter = 0;

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

  /** Any id is a Swiss that has just finished, so the whole flow can be tried without Lichess. */
  async getSwiss(swissId: string): Promise<SwissInfo | null> {
    return { id: swissId, name: "Simulated Swiss", status: "finished", round: 6, rounds: 6, players: 36, ongoing: 0 };
  }

  async createGameLink(request: LinkRequest): Promise<GameLink> {
    this.counter += 1;
    const id = `mock${String(this.counter).padStart(4, "0")}`;
    this.links.set(id, { request, open: true });
    return { id, url: `https://lichess.org/${id}` };
  }

  async isLinkOpen(id: string): Promise<boolean> {
    const link = this.links.get(id);
    return Boolean(link?.open && link.request.expiresAt.getTime() > Date.now() && !this.games.has(id));
  }

  async cancelLink(id: string): Promise<void> {
    const link = this.links.get(id);
    if (link) link.open = false;
  }

  async getGame(id: string): Promise<LichessGame | null> {
    return this.games.get(id) ?? null;
  }

  /** Development only: act as the players. Returns false if the event makes no sense for that link. */
  simulate(id: string, event: SimulatedEvent, now: Date): boolean {
    const link = this.links.get(id);
    if (!link) return false;
    const [white, black] = link.request.users;

    if (event === "join") {
      if (this.games.has(id) || !link.open) return false;
      this.games.set(id, { id, status: "started", winner: null, white, black, endedAt: null });
      return true;
    }

    const game = this.games.get(id);
    if (!game || game.status !== "started") return false;
    const ended = { ...game, endedAt: now };
    if (event === "abort") this.games.set(id, { ...ended, status: "aborted" });
    else if (event === "draw") this.games.set(id, { ...ended, status: "draw" });
    else this.games.set(id, { ...ended, status: "mate", winner: event });
    return true;
  }

  /** Development only: what the simulator would let you do next for a link. */
  stateOf(id: string): "unknown" | "waiting" | "started" | "finished" {
    const game = this.games.get(id);
    if (game) return game.status === "started" ? "started" : "finished";
    return this.links.has(id) ? "waiting" : "unknown";
  }
}
