import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, generatePassword, hashPassword, verifyPassword } from "./password";

describe("hashPassword and verifyPassword", () => {
  it("accepts the password the hash was made from", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("refuses any other password, including one that differs by a character", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("gives a different line each time, because of the salt, and both work", async () => {
    const [a, b] = await Promise.all([hashPassword("same password here"), hashPassword("same password here")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password here", a)).toBe(true);
    expect(await verifyPassword("same password here", b)).toBe(true);
  });

  it("writes the cost into the line, with colons so an env file keeps it, and never the password", async () => {
    const hash = await hashPassword("a very private password");
    expect(hash).toMatch(/^scrypt:32768:8:1:[\w-]+:[\w-]+$/);
    expect(hash).not.toContain("private");
  });

  it("tolerates a space or newline around the line, as pasted into a settings page", async () => {
    const hash = await hashPassword("pasted into settings");
    expect(await verifyPassword("pasted into settings", `  ${hash}\n`)).toBe(true);
  });

  it("never matches a line that is not in the format", async () => {
    for (const bad of ["", "scrypt", "scrypt:1:2:3", "bcrypt:32768:8:1:AAAA:BBBB", "scrypt:x:8:1:AAAA:BBBB", "scrypt:32768:8:1:AAAA:", "scrypt:32768:8:1:AAAA:BBBB:extra", "scrypt$32768$8$1$AAAA$BBBB"]) {
      expect(await verifyPassword("anything at all", bad)).toBe(false);
    }
  });

  it("refuses a cost that is not a power of two or would hang the server", async () => {
    expect(await verifyPassword("anything at all", "scrypt:1000:8:1:AAAA:BBBB")).toBe(false);
    expect(await verifyPassword("anything at all", `scrypt:${2 ** 30}:8:1:AAAA:BBBB`)).toBe(false);
  });
});

describe("generatePassword", () => {
  it("makes a long password from characters that cannot be mistaken for each other", () => {
    const password = generatePassword();
    expect(password).toHaveLength(24);
    expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
  });

  it("is different every time", () => {
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });
});
