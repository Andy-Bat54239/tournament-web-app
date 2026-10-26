import "server-only";
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
