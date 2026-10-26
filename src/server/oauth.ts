import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * "Log in with Lichess": the OAuth 2 Authorization Code flow with PKCE, as Lichess documents it
 * (https://lichess.org/api#tag/OAuth). There is nothing to register: the client id is just a name, and no
 * secret exists. The app asks for no permissions at all, only for who the person is, and revokes the token
 * the moment it has the username, so it never holds anything it could misuse.
 */

export const AUTHORIZE_URL = "https://lichess.org/oauth";
export const TOKEN_URL = "https://lichess.org/api/token";
export const ACCOUNT_URL = "https://lichess.org/api/account";
export const CALLBACK_PATH = "/api/auth/lichess/callback";
export const DEFAULT_CLIENT_ID = "castle-connect-ug";

const USER_AGENT = "CastleConnectUG-tournament-app";

/** Why a login did not complete. Each has plain wording on the login error page. */
export type LoginFailure = "denied" | "state" | "expired" | "failed" | "closed";

export class OAuthError extends Error {
  constructor(
    readonly reason: LoginFailure,
    message: string,
  ) {
    super(message);
  }
}

/** What the app remembers, in a short-lived signed cookie, while the person is away at Lichess. */
export interface LoginFlow {
  state: string;
  verifier: string;
  next: string;
}

/** Pages a login may return to. A fixed list, so a crafted link cannot send a player somewhere else. */
const RETURN_PAGES = ["/", "/match", "/bracket", "/organizer"];

export function safeNext(value: string | null | undefined): string {
  return value && RETURN_PAGES.includes(value) ? value : "/";
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** BASE64URL(SHA256(verifier)), as the PKCE standard (RFC 7636) defines the S256 challenge. */
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** A fresh secret the app keeps, and the challenge derived from it that Lichess sees first. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32)); // 43 characters, the minimum the standard allows
  return { verifier, challenge: challengeFor(verifier) };
}

/** Returned to us unchanged, so we can tell a login we started from one someone else forged. */
export function newState(): string {
  return base64url(randomBytes(24));
}

export function authorizeUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge_method: "S256",
    code_challenge: input.challenge,
    state: input.state,
  }).toString();
  return url.toString();
}

type FetchLike = typeof fetch;

async function send(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OAuthError("failed", "Could not reach Lichess.");
  }
}

/** Trades the one-time code for an access token. */
export async function exchangeCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const res = await send(input.fetchImpl ?? fetch, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
    }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!res.ok || typeof body?.access_token !== "string") {
    throw new OAuthError("failed", `Lichess refused the login code (HTTP ${res.status}).`);
  }
  return body.access_token;
}

export interface LichessAccount {
  /** In the capitals the person chose, as Lichess spells it. */
  username: string;
  /** Closed, or marked for breaking Lichess's rules. Such an account cannot play here. */
  closed: boolean;
}

/** Who the token belongs to. No scope is needed to read this. */
export async function fetchAccount(token: string, fetchImpl: FetchLike = fetch): Promise<LichessAccount> {
  const res = await send(fetchImpl, ACCOUNT_URL, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => null)) as { username?: unknown; disabled?: unknown; tosViolation?: unknown } | null;
  if (!res.ok || typeof body?.username !== "string") {
    throw new OAuthError("failed", `Could not read the Lichess account (HTTP ${res.status}).`);
  }
  return { username: body.username, closed: body.disabled === true || body.tosViolation === true };
}

/** Gives the token back. Best effort: if it fails the token expires on its own, and we never stored it. */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await send(fetchImpl, TOKEN_URL, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Nothing to do.
  }
}
