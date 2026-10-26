import { describe, expect, it } from "vitest";
import { decodeFlow, decodeSession, encodeFlow, encodeSession } from "./session";

const NOW = Date.UTC(2026, 9, 26, 10, 0);

describe("session cookie", () => {
  it("round-trips a username", () => {
    expect(decodeSession(encodeSession("Mercy_K", NOW), NOW)).toBe("Mercy_K");
  });

  it("expires after twelve hours", () => {
    const cookie = encodeSession("Mercy_K", NOW);
    expect(decodeSession(cookie, NOW + 11 * 3600_000)).toBe("Mercy_K");
    expect(decodeSession(cookie, NOW + 13 * 3600_000)).toBeNull();
  });

  it("rejects a cookie whose username was changed", () => {
    const [, signature] = encodeSession("Mercy_K", NOW).split(".");
    const forged = Buffer.from(JSON.stringify({ u: "Joel", exp: NOW / 1000 + 3600 })).toString("base64url");
    expect(decodeSession(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it("rejects missing, empty and malformed values", () => {
    for (const bad of [undefined, "", "abc", "a.b", ".", "a.b.c"]) {
      expect(decodeSession(bad, NOW)).toBeNull();
    }
  });
});

describe("login-in-progress cookie", () => {
  const flow = { state: "st-123", verifier: "v".repeat(43), next: "/match" };

  it("round-trips the state, the PKCE secret and where to go back to", () => {
    expect(decodeFlow(encodeFlow(flow, NOW), NOW)).toEqual(flow);
  });

  it("lasts ten minutes, which is plenty for a login and no longer", () => {
    const cookie = encodeFlow(flow, NOW);
    expect(decodeFlow(cookie, NOW + 9 * 60_000)).toEqual(flow);
    expect(decodeFlow(cookie, NOW + 11 * 60_000)).toBeNull();
  });

  it("rejects a cookie whose contents were changed", () => {
    const [, signature] = encodeFlow(flow, NOW).split(".");
    const forged = Buffer.from(JSON.stringify({ s: "attacker-state", v: flow.verifier, n: "/", exp: NOW / 1000 + 600 })).toString("base64url");
    expect(decodeFlow(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it("is not accepted as a session, and a session is not accepted as a login in progress", () => {
    expect(decodeSession(encodeFlow(flow, NOW), NOW)).toBeNull();
    expect(decodeFlow(encodeSession("Joel", NOW), NOW)).toBeNull();
  });

  it("rejects missing and malformed values", () => {
    for (const bad of [undefined, "", "abc", "a.b"]) expect(decodeFlow(bad, NOW)).toBeNull();
  });
});
