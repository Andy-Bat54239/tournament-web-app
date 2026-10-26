import { describe, expect, it } from "vitest";
import { completeLogin, startLogin } from "./login";
import { challengeFor } from "./oauth";

const REDIRECT = "http://localhost:3000/api/auth/lichess/callback";
const CLIENT = "castle-connect-ug";
const flow = { state: "state-abc-123", verifier: "v".repeat(43), next: "/match" };

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  throws?: boolean;
}

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: URLSearchParams }> = [];
  const impl = (async (url: string, init: { method?: string; headers: Record<string, string>; body?: URLSearchParams }) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body });
    const reply = replies.shift() ?? { status: 500, text: "no reply scripted" };
    if (reply.throws) throw new Error("network down");
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const good: Reply[] = [
  { body: { token_type: "Bearer", access_token: "lio_secret", expires_in: 31536000 } },
  { body: { id: "mercy_k", username: "Mercy_K" } },
  { status: 204, text: "" },
];

const run = (query: { code?: string | null; state?: string | null; error?: string | null }, replies: Reply[] = good, theFlow: typeof flow | null = flow) => {
  const { impl, calls } = fakeFetch([...replies]);
  const result = completeLogin({
    query: { code: query.code ?? null, state: query.state ?? null, error: query.error ?? null },
    flow: theFlow,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    fetchImpl: impl,
  });
  return { result, calls };
};

describe("startLogin", () => {
  it("makes the address to send the person to, and what to remember while they are away", () => {
    const { url, flow: remembered } = startLogin({ clientId: CLIENT, redirectUri: REDIRECT, next: "/match" });
    const params = new URL(url).searchParams;
    expect(params.get("state")).toBe(remembered.state);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("client_id")).toBe(CLIENT);
    // Lichess is shown only the challenge. The secret it came from stays with us.
    expect(params.get("code_challenge")).toBe(challengeFor(remembered.verifier));
    expect(url).not.toContain(remembered.verifier);
    expect(remembered.next).toBe("/match");
  });

  it("starts a new login every time, with new secrets", () => {
    const a = startLogin({ clientId: CLIENT, redirectUri: REDIRECT, next: null });
    const b = startLogin({ clientId: CLIENT, redirectUri: REDIRECT, next: null });
    expect(a.flow.state).not.toBe(b.flow.state);
    expect(a.flow.verifier).not.toBe(b.flow.verifier);
  });

  it("only ever returns to one of the app's own pages", () => {
    expect(startLogin({ clientId: CLIENT, redirectUri: REDIRECT, next: "https://evil.example" }).flow.next).toBe("/");
    expect(startLogin({ clientId: CLIENT, redirectUri: REDIRECT, next: null }).flow.next).toBe("/");
  });
});

describe("completeLogin: a login that works", () => {
  it("trades the code, learns the username in Lichess's capitals, revokes the token, and says where to go back to", async () => {
    const { result, calls } = run({ code: "the-code", state: flow.state });
    expect(await result).toEqual({ ok: true, username: "Mercy_K", next: "/match" });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://lichess.org/api/token",
      "GET https://lichess.org/api/account",
      "DELETE https://lichess.org/api/token",
    ]);
    expect(Object.fromEntries(calls[0].body!)).toMatchObject({
      code: "the-code",
      code_verifier: flow.verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
    });
    expect(calls[1].headers.Authorization).toBe("Bearer lio_secret");
    expect(calls[2].headers.Authorization).toBe("Bearer lio_secret"); // the same token is the one given back
  });

  it("still logs the person in if giving the token back fails, because it expires by itself", async () => {
    const { result } = run({ code: "c", state: flow.state }, [good[0], good[1], { throws: true }]);
    expect(await result).toMatchObject({ ok: true, username: "Mercy_K" });
  });
});

describe("completeLogin: a return that did not start here", () => {
  it("is turned away with no cookie, without calling Lichess", async () => {
    const { result, calls } = run({ code: "c", state: flow.state }, good, null);
    expect(await result).toEqual({ ok: false, reason: "expired" });
    expect(calls).toHaveLength(0);
  });

  it("is turned away when the state is missing or different, without calling Lichess", async () => {
    for (const state of [null, "", "wrong", "state-abc-12X", "state-abc-123-longer"]) {
      const { result, calls } = run({ code: "c", state });
      expect(await result).toEqual({ ok: false, reason: "state" });
      expect(calls).toHaveLength(0);
    }
  });

  it("checks the state even when Lichess reports an error, so a forged error is not believed either", async () => {
    const { result } = run({ error: "access_denied", state: "forged" });
    expect(await result).toEqual({ ok: false, reason: "state" });
  });
});

describe("completeLogin: a login that does not complete", () => {
  it("says so when the person chose not to allow it", async () => {
    const { result, calls } = run({ error: "access_denied", state: flow.state });
    expect(await result).toEqual({ ok: false, reason: "denied" });
    expect(calls).toHaveLength(0);
  });

  it("fails on any other error from Lichess, or on a return with no code", async () => {
    expect(await run({ error: "server_error", state: flow.state }).result).toEqual({ ok: false, reason: "failed" });
    expect(await run({ state: flow.state }).result).toEqual({ ok: false, reason: "failed" });
  });

  it("fails when Lichess refuses the code, and has no token to give back", async () => {
    const { result, calls } = run({ code: "c", state: flow.state }, [{ status: 400, body: { error: "invalid_grant" } }]);
    expect(await result).toEqual({ ok: false, reason: "failed" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a closed or restricted account, and still gives the token back", async () => {
    const { result, calls } = run({ code: "c", state: flow.state }, [good[0], { body: { username: "Gone", disabled: true } }, good[2]]);
    expect(await result).toEqual({ ok: false, reason: "closed" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("fails if the account cannot be read, and still gives the token back", async () => {
    const { result, calls } = run({ code: "c", state: flow.state }, [good[0], { status: 401, body: {} }, good[2]]);
    expect(await result).toEqual({ ok: false, reason: "failed" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("fails cleanly when Lichess cannot be reached", async () => {
    const { result } = run({ code: "c", state: flow.state }, [{ throws: true }]);
    expect(await result).toEqual({ ok: false, reason: "failed" });
  });
});
