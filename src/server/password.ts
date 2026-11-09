import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the super admin's sign-in. A password is never kept: only a salted scrypt hash of it, as one
 * line of text that can sit in a host's settings (`SUPER_ADMIN_PASSWORD_HASH`):
 *
 *   scrypt:<N>:<r>:<p>:<salt>:<hash>
 *
 * Colons, not dollar signs, so the line can sit in a .env file as well as in a host's settings page: an env file
 * reader treats $32768 as a variable and quietly drops it. The cost is written into the line, so it can be raised
 * later without breaking a hash made earlier. This file is plain Node, with no framework in it, so
 * `scripts/hash-password.mjs` can use it too.
 */

const COST = { N: 32768, r: 8, p: 1 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** scrypt needs about 128 x N x r bytes, which is just over Node's default limit at this cost. */
const MAX_MEMORY = 128 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
/** Longer than any password a person types. Stops someone sending a huge one to make the server work. */
export const MAX_PASSWORD_LENGTH = 200;

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

/** True only if `password` is the one the hash was made from. A hash that is not in the format above never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash, ...extra] = stored.trim().split(":");
  if (kind !== "scrypt" || !hash || extra.length > 0) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  if (cost.N > 2 ** 20 || cost.N & (cost.N - 1)) return false; // a power of two, and not so big it could hang the server
  const expected = Buffer.from(hash, "base64url");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(password, Buffer.from(salt, "base64url"), cost);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// No 0, O, 1, l or I, which look alike when written down.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random password of 24 characters, about 140 bits, for a person who does not want to think one up. */
export function generatePassword(length = 24): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
