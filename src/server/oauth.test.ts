import { describe, expect, it } from "vitest";
import {
  AUTHORIZE_URL,
  OAuthError,
  authorizeUrl,
  challengeFor,
  createPkce,
  exchangeCode,
  fetchAccount,
  newState,
  revokeToken,
  safeNext,
} from "./oauth";

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(replies: Array<{ status?: number; body?: unknown; text?: string; throws?: boolean }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: URLSearchParams }> = [];
  const impl = (async (url: string, init: { method?: string; headers: Record<string, string>; body?: URLSearchParams }) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body });
    const reply = replies.shift() ?? { status: 500, text: "no reply scripted" };
    if (reply.throws) throw new Error("network down");
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("PKCE", () => {
  it("matches the worked example in the standard (RFC 7636, appendix B)", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a long, URL-safe secret and its challenge, different every time", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(challengeFor(a.verifier));
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toContain("=");
  });

  it("makes an unguessable state", () => {
    expect(newState()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newState()).not.toBe(newState());
  });
});

describe("authorizeUrl", () => {
  it("sends the person to Lichess with PKCE, asking for no permissions", () => {
    const url = new URL(
      authorizeUrl({ clientId: "castle-connect-ug", redirectUri: "https://example.org/api/auth/lichess/callback", state: "st", challenge: "ch" }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "castle-connect-ug",
      redirect_uri: "https://example.org/api/auth/lichess/callback",
      code_challenge_method: "S256",
      code_challenge: "ch",
      state: "st",
    });
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("safeNext", () => {
  it("returns to one of the app's own pages", () => {
    for (const page of ["/", "/match", "/bracket", "/organizer"]) expect(safeNext(page)).toBe(page);
  });

  it("sends anything else home, so a crafted link cannot redirect a player elsewhere", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/match/../../x", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("exchangeCode", () => {
  const input = { code: "the-code", verifier: "the-verifier", redirectUri: "http://localhost:3000/cb", clientId: "castle-connect-ug" };

  it("posts the code with the verifier and gives back the token", async () => {
    const { impl, calls } = fakeFetch([{ body: { token_type: "Bearer", access_token: "lio_abc", expires_in: 31536000 } }]);
    expect(await exchangeCode({ ...input, fetchImpl: impl })).toBe("lio_abc");
    expect(calls[0].url).toBe("https://lichess.org/api/token");
    expect(calls[0].method).toBe("POST");
    expect(Object.fromEntries(calls[0].body!)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: "http://localhost:3000/cb",
      client_id: "castle-connect-ug",
    });
  });

  it("fails when Lichess refuses the code", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    await expect(exchangeCode({ ...input, fetchImpl: impl })).rejects.toMatchObject({ reason: "failed" });
  });

  it("fails on an answer with no token, or one that is not JSON", async () => {
    await expect(exchangeCode({ ...input, fetchImpl: fakeFetch([{ body: {} }]).impl })).rejects.toBeInstanceOf(OAuthError);
    await expect(exchangeCode({ ...input, fetchImpl: fakeFetch([{ text: "<html>" }]).impl })).rejects.toBeInstanceOf(OAuthError);
  });

  it("fails cleanly when Lichess cannot be reached", async () => {
    await expect(exchangeCode({ ...input, fetchImpl: fakeFetch([{ throws: true }]).impl })).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("fetchAccount", () => {
  it("reads the username in Lichess's capitals, using the token", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "mercy_k", username: "Mercy_K", perfs: {} } }]);
    expect(await fetchAccount("lio_abc", impl)).toEqual({ username: "Mercy_K", closed: false });
    expect(calls[0].url).toBe("https://lichess.org/api/account");
    expect(calls[0].headers.Authorization).toBe("Bearer lio_abc");
  });

  it("marks a closed or restricted account", async () => {
    expect((await fetchAccount("t", fakeFetch([{ body: { username: "Gone", disabled: true } }]).impl)).closed).toBe(true);
    expect((await fetchAccount("t", fakeFetch([{ body: { username: "Bad", tosViolation: true } }]).impl)).closed).toBe(true);
  });

  it("fails when the token is refused", async () => {
    await expect(fetchAccount("t", fakeFetch([{ status: 401, body: { error: "No such token" } }]).impl)).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("revokeToken", () => {
  it("deletes the token, using the token", async () => {
    const { impl, calls } = fakeFetch([{ status: 204, text: "" }]);
    await revokeToken("lio_abc", impl);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://lichess.org/api/token" });
    expect(calls[0].headers.Authorization).toBe("Bearer lio_abc");
  });

  it("never throws, because the token expires by itself anyway", async () => {
    await expect(revokeToken("t", fakeFetch([{ throws: true }]).impl)).resolves.toBeUndefined();
    await expect(revokeToken("t", fakeFetch([{ status: 500, text: "boom" }]).impl)).resolves.toBeUndefined();
  });
});
