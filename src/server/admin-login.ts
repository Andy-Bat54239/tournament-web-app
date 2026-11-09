import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { waitText } from "@/domain/login-throttle";
import { sameUser } from "@/domain/registration";
import { DEV_ADMIN_PASSWORD, type AdminPassword } from "./auth-config";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password";
import type { Store } from "./store";

export type AdminSignIn = { ok: true } | { ok: false; error: string };

export interface AdminSignInSetup {
  /** The super admin's username, or null if none is set. */
  name: string | null;
  /** How to check the password, or null if the sign-in is not switched on. */
  password: AdminPassword | null;
  /** `updateStore`, or anything that runs a change on a working copy of the tournament. */
  update: <T>(change: (store: Store) => T | Promise<T>) => Promise<T>;
}

const NOT_SWITCHED_ON = "Super admin sign-in is not switched on.";
const EMPTY = "Enter your username and password.";
const WRONG = "That username and password do not match.";

async function matches(given: string, how: AdminPassword): Promise<boolean> {
  if (how.kind === "hash") return verifyPassword(given, how.hash);
  // The development password. Hashed first so both sides are the same length for the comparison.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(DEV_ADMIN_PASSWORD));
}

/**
 * Checks a username and password for the super admin. Says nothing about which of the two was wrong, always does the
 * work of checking the password so the time taken gives nothing away, and counts wrong tries per `source`, locking a
 * source that keeps guessing (see `login-throttle`). Does not start the session: the caller does that on `ok`.
 */
export async function attemptAdminSignIn(
  input: { username: string; password: string; source: string; now: Date },
  setup: AdminSignInSetup,
): Promise<AdminSignIn> {
  const { name, password: how, update } = setup;
  if (!name || !how) return { ok: false, error: NOT_SWITCHED_ON };
  const username = input.username.trim();
  if (!username || !input.password) return { ok: false, error: EMPTY };

  const wait = await update((store) => store.signInWait(input.source, input.now));
  if (wait > 0) return { ok: false, error: `Too many wrong tries. Try again in ${waitText(wait)}.` };

  const passwordRight = input.password.length <= MAX_PASSWORD_LENGTH && (await matches(input.password, how));
  const ok = passwordRight && sameUser(username, name);

  const { lockedMs } = await update((store) => store.recordSignIn(input.source, ok, input.now));
  if (ok) return { ok: true };
  return { ok: false, error: lockedMs > 0 ? `${WRONG} Too many wrong tries: try again in ${waitText(lockedMs)}.` : WRONG };
}
