import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "./session";

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
