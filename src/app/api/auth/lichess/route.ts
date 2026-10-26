import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, clientId, loginMode, redirectUri } from "@/server/auth-config";
import { startLogin } from "@/server/login";
import { FLOW_COOKIE, encodeFlow, flowCookieOptions } from "@/server/session";

/** Starts "Log in with Lichess": remembers the login in a short-lived signed cookie, then sends the person to Lichess. */
export async function GET(request: NextRequest) {
  if (loginMode() !== "oauth") {
    return NextResponse.redirect(new URL("/login/error?reason=unavailable", appOrigin(request.url)));
  }
  const { url, flow } = startLogin({
    clientId: clientId(),
    redirectUri: redirectUri(request.url),
    next: request.nextUrl.searchParams.get("next"),
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(FLOW_COOKIE, encodeFlow(flow, Date.now()), flowCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
