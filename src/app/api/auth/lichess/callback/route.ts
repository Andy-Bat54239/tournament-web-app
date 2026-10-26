import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, clientId, loginMode, redirectUri } from "@/server/auth-config";
import { completeLogin } from "@/server/login";
import {
  FLOW_COOKIE,
  SESSION_COOKIE,
  decodeFlow,
  encodeSession,
  flowCookieOptions,
  sessionCookieOptions,
} from "@/server/session";

/** Where Lichess sends the person back to. Finishes the login, starts the session, and goes back to the page they were on. */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request.url);
  if (loginMode() !== "oauth") {
    return NextResponse.redirect(new URL("/login/error?reason=unavailable", origin));
  }

  const params = request.nextUrl.searchParams;
  const result = await completeLogin({
    query: { code: params.get("code"), state: params.get("state"), error: params.get("error") },
    flow: decodeFlow(request.cookies.get(FLOW_COOKIE)?.value, Date.now()),
    clientId: clientId(),
    redirectUri: redirectUri(request.url),
  });

  const response = NextResponse.redirect(new URL(result.ok ? result.next : `/login/error?reason=${result.reason}`, origin));
  // The login is used up, whether or not it worked. A second return with the same code gets nowhere.
  response.cookies.set(FLOW_COOKIE, "", { ...flowCookieOptions(), maxAge: 0 });
  if (result.ok) response.cookies.set(SESSION_COOKIE, encodeSession(result.username, Date.now()), sessionCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
