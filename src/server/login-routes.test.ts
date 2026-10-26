import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as start } from "@/app/api/auth/lichess/route";
import { GET as callback } from "@/app/api/auth/lichess/callback/route";
import { FLOW_COOKIE, SESSION_COOKIE, decodeFlow, decodeSession, encodeFlow } from "./session";

const ORIGIN = "http://localhost:3000";
const flow = { state: "state-abc-123", verifier: "v".repeat(43), next: "/match" };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LICHESS_LOGIN", "oauth");
  vi.stubEnv("APP_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Lichess, scripted: the token, the account, and the revoke. */
function lichessSays(replies: Array<{ status?: number; body?: unknown; text?: string }>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { method?: string }) => {
      calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
      const reply = replies.shift() ?? { status: 500, text: "no reply scripted" };
      return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    },
  );
  return calls;
}

const goodLichess = () => [
  { body: { token_type: "Bearer", access_token: "lio_secret", expires_in: 1 } },
  { body: { id: "mercy_k", username: "Mercy_K" } },
  { status: 204, text: "" },
];

const request = (path: string, cookie?: string) =>
  new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);

const returning = (query: string, theFlow: typeof flow | null = flow) =>
  callback(request(`/api/auth/lichess/callback?${query}`, theFlow ? `${FLOW_COOKIE}=${encodeFlow(theFlow, Date.now())}` : undefined));

describe("starting a login", () => {
  it("sends the person to Lichess and remembers the login in a signed cookie only the login routes see", async () => {
    const response = await start(request("/api/auth/lichess?next=/match"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe("https://lichess.org/oauth");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/lichess/callback`);
    expect(location.searchParams.get("scope")).toBeNull();

    const cookie = response.cookies.get(FLOW_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/auth/lichess", maxAge: 600 });
    const remembered = decodeFlow(cookie.value, Date.now())!;
    expect(remembered.state).toBe(location.searchParams.get("state"));
    expect(remembered.next).toBe("/match");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // The PKCE secret is in the cookie, never in the address Lichess sees.
    expect(response.headers.get("location")).not.toContain(remembered.verifier);
  });

  it("only returns to the app's own pages", async () => {
    const response = await start(request("/api/auth/lichess?next=https://evil.example"));
    expect(decodeFlow(response.cookies.get(FLOW_COOKIE)!.value, Date.now())!.next).toBe("/");
  });

  it("is not available when the stand-in login is the chosen mode", async () => {
    vi.stubEnv("LICHESS_LOGIN", "mock");
    const response = await start(request("/api/auth/lichess"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=unavailable`);
    expect(response.cookies.get(FLOW_COOKIE)).toBeUndefined();
  });
});

describe("coming back from Lichess", () => {
  it("starts a session for the username Lichess gave, uses up the login, and goes back to the page", async () => {
    const calls = lichessSays(goodLichess());
    const response = await returning("code=the-code&state=state-abc-123");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/match`);
    const session = response.cookies.get(SESSION_COOKIE)!;
    expect(decodeSession(session.value, Date.now())).toBe("Mercy_K");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
    // The login cookie is cleared, so the same return cannot be used twice.
    expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({ value: "", maxAge: 0, path: "/api/auth/lichess" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual(["POST /api/token", "GET /api/account", "DELETE /api/token"]);
  });

  it("starts no session when the state is wrong, and never calls Lichess", async () => {
    const calls = lichessSays(goodLichess());
    const response = await returning("code=the-code&state=forged");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=state`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({ maxAge: 0 });
    expect(calls).toEqual([]);
  });

  it("starts no session without the login cookie, for instance if it expired or was blocked", async () => {
    lichessSays(goodLichess());
    const response = await returning("code=the-code&state=state-abc-123", null);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=expired`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("starts no session when the person said no", async () => {
    const response = await returning("error=access_denied&state=state-abc-123");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=denied`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("starts no session for a closed account, and still gives the token back", async () => {
    const calls = lichessSays([goodLichess()[0], { body: { username: "Gone", disabled: true } }, { status: 204, text: "" }]);
    const response = await returning("code=the-code&state=state-abc-123");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=closed`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(calls.at(-1)).toBe("DELETE /api/token");
  });

  it("does not use a session cookie, or a login cookie from another login, in its place", async () => {
    lichessSays(goodLichess());
    const response = await callback(request("/api/auth/lichess/callback?code=c&state=state-abc-123", `${SESSION_COOKIE}=whatever`));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=expired`);
  });

  it("is not available when the stand-in login is the chosen mode", async () => {
    vi.stubEnv("LICHESS_LOGIN", "mock");
    const response = await returning("code=c&state=state-abc-123");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/error?reason=unavailable`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("in production", () => {
  it("uses the configured https address for the redirect, not whatever address the request claims", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://tournament.example.org");
    vi.stubEnv("SESSION_SECRET", "a-long-test-secret");
    const response = await start(new NextRequest("http://internal-host:8080/api/auth/lichess"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe("https://tournament.example.org/api/auth/lichess/callback");
    expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({ secure: true });
  });
});
