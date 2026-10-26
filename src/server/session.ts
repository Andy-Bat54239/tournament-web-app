import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Signed cookie holding the Lichess username. The username only ever comes from
 * the (mock, for now) Lichess login, never from a typed field on a public form.
 */

const COOKIE = "cc_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

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

export function encodeSession(username: string, nowMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Math.floor(nowMs / 1000) + MAX_AGE_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined, nowMs: number): string | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "string" || typeof exp !== "number") return null;
    return exp * 1000 > nowMs ? u : null;
  } catch {
    return null;
  }
}

export async function setSession(username: string): Promise<void> {
  (await cookies()).set(COOKIE, encodeSession(username, Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The logged-in Lichess username, or null. Reads cookies, so call it behind <Suspense>. */
export async function getSessionUsername(): Promise<string | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value, Date.now());
}
