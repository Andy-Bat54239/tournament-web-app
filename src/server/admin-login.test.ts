import { beforeAll, describe, expect, it } from "vitest";
import { DEV_ADMIN_PASSWORD } from "./auth-config";
import { attemptAdminSignIn, type AdminSignInSetup } from "./admin-login";
import { hashPassword } from "./password";
import { setup as world } from "@/test/fixtures";
import type { Store } from "./store";

const PASSWORD = "a long enough password";
const NOW = new Date(Date.UTC(2026, 10, 9, 12, 0, 0));
const later = (ms: number) => new Date(NOW.getTime() + ms);

let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

/** The sign-in against a real Store, with Joel as the super admin and the password above. */
function signIn(over: Partial<AdminSignInSetup> = {}) {
  const store: Store = world().store;
  const setup: AdminSignInSetup = {
    name: "Joel",
    password: { kind: "hash", hash },
    update: async (change) => change(store),
    ...over,
  };
  const attempt = (username: string, password: string, source = "s1", now = NOW) =>
    attemptAdminSignIn({ username, password, source, now }, setup);
  return { store, attempt };
}

describe("a right username and password", () => {
  it("signs in, whichever way the username is capitalised, and logs it", async () => {
    const { store, attempt } = signIn();
    expect(await attempt("Joel", PASSWORD)).toEqual({ ok: true });
    expect(await attempt("  joel ", PASSWORD)).toEqual({ ok: true });
    expect(store.audit.at(-1)).toMatchObject({ actor: "Joel", action: "Signed in." });
  });

  it("clears the wrong tries", async () => {
    const { store, attempt } = signIn();
    await attempt("Joel", "wrong one", "s1");
    await attempt("Joel", "wrong two", "s1");
    await attempt("Joel", PASSWORD, "s1");
    expect(store.signInAttempts).toEqual({});
  });
});

describe("a wrong one", () => {
  it("says only that they do not match, for a wrong password, a wrong username, or both", async () => {
    const { attempt } = signIn();
    const wrong = { ok: false, error: "That username and password do not match." };
    expect(await attempt("Joel", "not the password")).toEqual(wrong);
    expect(await attempt("Someone", PASSWORD)).toEqual(wrong);
    expect(await attempt("Someone", "not the password")).toEqual(wrong);
  });

  it("does not sign in with the hash itself, or a password that only starts like the right one", async () => {
    const { attempt } = signIn();
    expect((await attempt("Joel", hash)).ok).toBe(false);
    expect((await attempt("Joel", PASSWORD.slice(0, -1))).ok).toBe(false);
    expect((await attempt("Joel", `${PASSWORD} `)).ok).toBe(false);
  });

  it("refuses a huge password without trying to check it", async () => {
    const { attempt } = signIn();
    expect((await attempt("Joel", "x".repeat(100_000))).ok).toBe(false);
  });

  it("asks for both when one is empty, and does not count that as a wrong try", async () => {
    const { store, attempt } = signIn();
    expect(await attempt("", PASSWORD)).toEqual({ ok: false, error: "Enter your username and password." });
    expect(await attempt("Joel", "")).toEqual({ ok: false, error: "Enter your username and password." });
    expect(store.signInAttempts).toEqual({});
  });
});

describe("guessing", () => {
  it("locks a source after a few wrong tries, even against the right password, and says for how long", async () => {
    const { attempt } = signIn();
    for (let i = 0; i < 4; i++) expect((await attempt("Joel", `wrong ${i}`, "s1", later(i * 1000))).ok).toBe(false);

    const fifth = await attempt("Joel", "wrong 4", "s1", later(4000));
    expect(fifth).toEqual({ ok: false, error: expect.stringContaining("try again in 30 seconds") });

    const during = await attempt("Joel", PASSWORD, "s1", later(10_000));
    expect(during).toEqual({ ok: false, error: "Too many wrong tries. Try again in 24 seconds." });
  });

  it("lets the right password in again once the lock has run out", async () => {
    const { attempt } = signIn();
    for (let i = 0; i < 5; i++) await attempt("Joel", `wrong ${i}`, "s1", later(i * 1000));
    expect((await attempt("Joel", PASSWORD, "s1", later(4000 + 30_000))).ok).toBe(true);
  });

  it("does not lock out the real super admin because a stranger is guessing from somewhere else", async () => {
    const { attempt } = signIn();
    for (let i = 0; i < 8; i++) await attempt("Joel", `wrong ${i}`, "stranger", later(i * 1000));
    expect(await attempt("Joel", "still wrong", "stranger", later(9000))).toEqual({ ok: false, error: expect.stringContaining("Too many wrong tries") });
    expect(await attempt("Joel", PASSWORD, "the-real-admin", later(9000))).toEqual({ ok: true });
  });
});

describe("when it is not switched on", () => {
  it("lets nobody in without a super admin name or a password, and counts nothing", async () => {
    for (const over of [{ name: null }, { password: null }]) {
      const { store, attempt } = signIn(over);
      expect(await attempt("Joel", PASSWORD)).toEqual({ ok: false, error: "Super admin sign-in is not switched on." });
      expect(store.signInAttempts).toEqual({});
    }
  });

  it("accepts only the development password where that is the setup, and not the hash's password", async () => {
    const { attempt } = signIn({ password: { kind: "development" } });
    expect((await attempt("Joel", DEV_ADMIN_PASSWORD)).ok).toBe(true);
    expect((await attempt("Joel", PASSWORD)).ok).toBe(false);
    expect((await attempt("Mercy_K", DEV_ADMIN_PASSWORD)).ok).toBe(false);
  });
});
