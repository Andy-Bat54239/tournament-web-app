import "server-only";
import { sameUser } from "@/domain/registration";
import { CALLBACK_PATH, DEFAULT_CLIENT_ID } from "./oauth";

/**
 * How people log in:
 *   LICHESS_LOGIN=oauth   the real "Log in with Lichess"
 *   LICHESS_LOGIN=mock    a stand-in that lets you type any username (development and demos only)
 * When it is not set, the real Lichess (LICHESS_MODE=live) means OAuth, and anything else means the mock.
 */
export type LoginMode = "oauth" | "mock";

export function loginMode(): LoginMode {
  const chosen = process.env.LICHESS_LOGIN;
  if (chosen === "oauth" || chosen === "mock") return chosen;
  return process.env.LICHESS_MODE === "live" ? "oauth" : "mock";
}

/** The name Lichess shows for this app on its permission page. Nothing is registered under it. */
export function clientId(): string {
  return process.env.LICHESS_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/**
 * The public address of the app, with no trailing slash. In production it must be set, and be https, because
 * a redirect address built from a request header could be steered by whoever sends the request.
 */
export function appOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    const parsed = new URL(configured);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error("APP_URL must start with https:// in production.");
    }
    return parsed.origin;
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL must be set in production.");
  return new URL(requestUrl).origin;
}

export const redirectUri = (requestUrl: string) => `${appOrigin(requestUrl)}${CALLBACK_PATH}`;

/**
 * The super admin signs in with a username and a password, not with Lichess. SUPER_ADMIN is the username. Outside
 * production it defaults to "Joel", so a local copy works with nothing set.
 */
export function superAdminName(): string | null {
  const chosen = process.env.SUPER_ADMIN?.trim();
  if (chosen) return chosen;
  return process.env.NODE_ENV === "production" ? null : "Joel";
}

/** The password for the local copy only. Production never accepts it: there, the hash below has to be set. */
export const DEV_ADMIN_PASSWORD = "dev-password";

/**
 * How the super admin's password is checked: against SUPER_ADMIN_PASSWORD_HASH (made by `npm run hash-password`), or,
 * outside production and with no hash set, against the development password. Null in production with no hash, which
 * turns the super admin's sign-in off, so nobody can get in until it is set.
 */
export type AdminPassword = { kind: "hash"; hash: string } | { kind: "development" };

export function adminPassword(): AdminPassword | null {
  const hash = process.env.SUPER_ADMIN_PASSWORD_HASH?.trim();
  if (hash) return { kind: "hash", hash };
  return process.env.NODE_ENV === "production" ? null : { kind: "development" };
}

/**
 * The super admin's name can never be used to log in with Lichess. Somebody who owns a Lichess account with the same
 * name would otherwise be the super admin.
 */
export function isSuperAdminName(username: string): boolean {
  const name = superAdminName();
  return name !== null && sameUser(username, name);
}
