import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  OAuthError,
  authorizeUrl,
  createPkce,
  exchangeCode,
  fetchAccount,
  newState,
  revokeToken,
  safeNext,
  type LoginFailure,
  type LoginFlow,
} from "./oauth";

/** The first half: make the secrets, and the address to send the person to. */
export function startLogin(input: { clientId: string; redirectUri: string; next: string | null }): { url: string; flow: LoginFlow } {
  const { verifier, challenge } = createPkce();
  const state = newState();
  return {
    url: authorizeUrl({ clientId: input.clientId, redirectUri: input.redirectUri, state, challenge }),
    flow: { state, verifier, next: safeNext(input.next) },
  };
}

export type LoginResult = { ok: true; username: string; next: string } | { ok: false; reason: LoginFailure };

const fail = (reason: LoginFailure): LoginResult => ({ ok: false, reason });

function sameState(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The second half: Lichess has sent the person back. Checks that this is the login we started, trades the code
 * for a token, learns the username, and gives the token back. Whatever happens, the token is revoked.
 */
export async function completeLogin(input: {
  query: { code: string | null; state: string | null; error: string | null };
  /** From the signed cookie, or null if it is missing, expired or altered. */
  flow: LoginFlow | null;
  clientId: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<LoginResult> {
  const { query, flow } = input;
  if (!flow) return fail("expired");
  // The state first, before anything else is believed. A mismatch means this return did not start here.
  if (!query.state || !sameState(query.state, flow.state)) return fail("state");
  if (query.error) return fail(query.error === "access_denied" ? "denied" : "failed");
  if (!query.code) return fail("failed");

  let token: string | null = null;
  try {
    token = await exchangeCode({
      code: query.code,
      verifier: flow.verifier,
      redirectUri: input.redirectUri,
      clientId: input.clientId,
      fetchImpl: input.fetchImpl,
    });
    const account = await fetchAccount(token, input.fetchImpl);
    if (account.closed) return fail("closed");
    return { ok: true, username: account.username, next: flow.next };
  } catch (error) {
    return fail(error instanceof OAuthError ? error.reason : "failed");
  } finally {
    if (token) await revokeToken(token, input.fetchImpl);
  }
}
