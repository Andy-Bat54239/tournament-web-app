import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { LoginFlow } from "./oauth";

/**
 * Two signed cookies. The session holds the Lichess username, which only ever comes from the Lichess login,
 * never from a typed field on a public form. The flow cookie holds a login in progress (its state and PKCE
 * secret) for ten minutes, and is only sent to the login routes.
 */

export const SESSION_COOKIE = "cc_session";
export const FLOW_COOKIE = "cc_oauth";
const MAX_AGE_SECONDS = 12 * 60 * 60;
const FLOW_MAX_AGE_SECONDS = 10 * 60;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return "dev-only-secret-not-for-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Turns data into a tamper-proof cookie value. */
function seal(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The data inside a cookie value, or null if it was altered or is not ours. */
function unseal(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

const expiry = (nowMs: number, seconds: number) => Math.floor(nowMs / 1000) + seconds;
const stillValid = (exp: unknown, nowMs: number) => typeof exp === "number" && exp * 1000 > nowMs;

export function encodeSession(username: string, nowMs: number): string {
  return seal({ u: username, exp: expiry(nowMs, MAX_AGE_SECONDS) });
}

export function decodeSession(value: string | undefined, nowMs: number): string | null {
  const data = unseal(value);
  if (!data || typeof data.u !== "string" || !stillValid(data.exp, nowMs)) return null;
  return data.u;
}

export function encodeFlow(flow: LoginFlow, nowMs: number): string {
  return seal({ s: flow.state, v: flow.verifier, n: flow.next, exp: expiry(nowMs, FLOW_MAX_AGE_SECONDS) });
}

export function decodeFlow(value: string | undefined, nowMs: number): LoginFlow | null {
  const data = unseal(value);
  if (!data || typeof data.s !== "string" || typeof data.v !== "string" || typeof data.n !== "string") return null;
  return stillValid(data.exp, nowMs) ? { state: data.s, verifier: data.v, next: data.n } : null;
}

const base = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" });

export const sessionCookieOptions = () => ({ ...base(), path: "/", maxAge: MAX_AGE_SECONDS });
/** Lax, so it comes back with the redirect from Lichess; scoped to the login routes, so nothing else sees it. */
export const flowCookieOptions = () => ({ ...base(), path: "/api/auth/lichess", maxAge: FLOW_MAX_AGE_SECONDS });

export async function setSession(username: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, encodeSession(username, Date.now()), sessionCookieOptions());
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The logged-in Lichess username, or null. Reads cookies, so call it behind <Suspense>. */
export async function getSessionUsername(): Promise<string | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value, Date.now());
}
