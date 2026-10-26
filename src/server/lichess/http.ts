import {
  LichessError,
  LichessRateLimited,
  type GameLink,
  type LichessClient,
  type LichessGame,
  type LichessProfile,
  type LinkRequest,
  type StandingRow,
} from "./types";

interface Reply {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
}

export interface HttpLichessOptions {
  /** Personal access token of the account that creates the game links. Scopes: challenge:read, challenge:write. */
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The real Lichess, for the calls the app needs. Every request goes through one queue, because Lichess asks
 * API users to make one request at a time and answers HTTP 429 otherwise. A 429 is reported, never retried
 * here: Lichess says to wait at least a minute.
 */
export class HttpLichess implements LichessClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor({ token, baseUrl = "https://lichess.org", fetchImpl = fetch, timeoutMs = 10_000 }: HttpLichessOptions) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private request(
    method: "GET" | "POST",
    path: string,
    options: { form?: Record<string, string | number | undefined>; query?: Record<string, string | number | boolean>; auth?: boolean; ndjson?: boolean } = {},
  ): Promise<Reply> {
    const run = async (): Promise<Reply> => {
      const url = new URL(path, this.baseUrl);
      for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
      const headers: Record<string, string> = {
        Accept: options.ndjson ? "application/x-ndjson" : "application/json",
        "User-Agent": "CastleConnectUG-tournament-app",
      };
      if (options.auth) headers.Authorization = `Bearer ${this.token}`;
      let body: URLSearchParams | undefined;
      if (options.form) {
        body = new URLSearchParams(Object.entries(options.form).filter((e): e is [string, string | number] => e[1] !== undefined).map(([k, v]) => [k, String(v)]));
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      const res = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (res.status === 429) throw new LichessRateLimited(`Lichess is busy (HTTP 429) on ${method} ${url.pathname}. Wait a minute.`);
      return { status: res.status, ok: res.ok, json, text };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async getProfile(username: string): Promise<LichessProfile | null> {
    const res = await this.request("GET", `/api/user/${encodeURIComponent(username)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new LichessError(`Could not read the Lichess profile of ${username} (HTTP ${res.status}).`);
    const user = res.json as { username: string; perfs?: { blitz?: { rating: number; prov?: boolean } } };
    const blitz = user.perfs?.blitz;
    const provisional = !blitz || blitz.prov === true;
    return { username: user.username, blitzRating: provisional || !blitz ? null : blitz.rating, provisional };
  }

  async getSwissStandings({ swissId }: { swissId: string | null; entrants: string[] }): Promise<StandingRow[]> {
    if (!swissId) throw new LichessError("There is no Swiss tournament id to read standings from.");
    const res = await this.request("GET", `/api/swiss/${encodeURIComponent(swissId)}/results`, { ndjson: true });
    if (!res.ok) throw new LichessError(`Could not read the Swiss standings (HTTP ${res.status}).`);
    return res.text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { rank: number; username: string; points: number })
      .map(({ rank, username, points }) => ({ rank, username, points }));
  }

  async createGameLink(request: LinkRequest): Promise<GameLink> {
    const res = await this.request("POST", "/api/challenge/open", {
      auth: true,
      form: {
        "clock.limit": request.clock.limit,
        "clock.increment": request.clock.increment,
        rated: "false",
        users: request.users.join(","),
        rules: request.rules,
        name: request.name,
        expiresAt: request.expiresAt.getTime(),
      },
    });
    const id = (res.json as { id?: string } | undefined)?.id;
    if (!res.ok || !id) throw new LichessError(`Lichess would not create the game link (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    return { id, url: `${this.baseUrl}/${id}` };
  }

  async isLinkOpen(id: string): Promise<boolean> {
    const res = await this.request("GET", `/api/challenge/${encodeURIComponent(id)}/show`, { auth: true });
    return res.ok && (res.json as { status?: string } | undefined)?.status === "created";
  }

  async cancelLink(id: string): Promise<void> {
    // 404 and 400 mean it is already gone, expired, cancelled or started, which is what we wanted.
    const res = await this.request("POST", `/api/challenge/${encodeURIComponent(id)}/cancel`, { auth: true });
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      throw new LichessError(`Could not cancel the game link (HTTP ${res.status}).`);
    }
  }

  async getGame(id: string): Promise<LichessGame | null> {
    const res = await this.request("GET", `/game/export/${encodeURIComponent(id)}`, {
      query: { moves: false, clocks: false, evals: false, opening: false, division: false, tags: false },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new LichessError(`Could not read game ${id} (HTTP ${res.status}).`);
    const game = res.json as {
      id: string;
      status: string;
      winner?: "white" | "black";
      lastMoveAt?: number;
      players?: { white?: { user?: { name?: string } }; black?: { user?: { name?: string } } };
    };
    const finished = game.status !== "created" && game.status !== "started";
    return {
      id: game.id,
      status: game.status,
      winner: game.winner ?? null,
      white: game.players?.white?.user?.name ?? null,
      black: game.players?.black?.user?.name ?? null,
      endedAt: finished && game.lastMoveAt ? new Date(game.lastMoveAt) : null,
    };
  }
}
