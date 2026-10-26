// Minimal Lichess API client for the verification checks (brief, section 8).
//
// Requests run strictly one at a time: Lichess asks API users to make one request
// at a time and answers HTTP 429 otherwise. A 429 stops the run so we learn the
// limit instead of hammering past it. Tokens are read from the environment and are
// never printed or written to results.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://lichess.org";
const USER_AGENT = "CastleConnectUG-api-checks";
const here = dirname(fileURLToPath(import.meta.url));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimited extends Error {
  constructor(request, response) {
    super(`HTTP 429 from ${request}. Lichess says to wait at least a minute. Body: ${response.raw.slice(0, 200)}`);
    this.response = response;
  }
}

let queue = Promise.resolve();
function inOrder(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** Every call made, for the results file. No headers, no tokens. */
export const calls = [];

/**
 * @param {{ token?: string, method?: string, path: string, query?: object, form?: object,
 *           text?: string, accept?: string, allow429?: boolean }} options
 */
export function api({ token, method = "GET", path, query, form, text, accept = "application/json", allow429 = false }) {
  return inOrder(async () => {
    const url = new URL(path, BASE);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));

    const headers = { "User-Agent": USER_AGENT, Accept: accept };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (form) {
      body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined));
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (text !== undefined) {
      body = text;
      headers["Content-Type"] = "text/plain";
    }

    const started = Date.now();
    const res = await fetch(url, { method, headers, body });
    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const rateHeaders = Object.fromEntries([...res.headers].filter(([name]) => /rate|retry/i.test(name)));
    const response = { status: res.status, ok: res.ok, json, raw, rateHeaders };
    calls.push({ method, path: url.pathname, status: res.status, ms: Date.now() - started });
    if (res.status === 429 && !allow429) throw new RateLimited(`${method} ${url.pathname}`, response);
    return response;
  });
}

/** Reads an NDJSON stream for `ms`, then closes it. Runs outside the one-at-a-time queue on purpose. */
export async function sampleStream({ token, method = "GET", path, text, ms }) {
  const controller = new AbortController();
  const headers = { "User-Agent": USER_AGENT, Accept: "application/x-ndjson" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (text !== undefined) headers["Content-Type"] = "text/plain";
  const res = await fetch(new URL(path, BASE), { method, headers, body: text, signal: controller.signal });
  const result = { status: res.status, lines: [], rateHeaders: Object.fromEntries([...res.headers].filter(([n]) => /rate|retry/i.test(n))) };
  if (!res.ok) {
    result.raw = (await res.text()).slice(0, 300);
    return result;
  }
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      result.lines.push(...lines.filter(Boolean));
    }
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timer);
  }
  return result;
}

/** A, B and C are the three test accounts. Usernames come from the tokens, never from the env file. */
export const REQUIRED_SCOPES = ["challenge:read", "challenge:write", "board:play", "team:write", "tournament:write"];

export function loadAccounts() {
  try {
    process.loadEnvFile(join(here, ".env.local"));
  } catch {
    // No file: fall through to whatever is already in the environment.
  }
  const accounts = {};
  for (const key of ["A", "B", "C"]) {
    const token = process.env[`LICHESS_${key}_TOKEN`]?.trim();
    if (token) accounts[key] = { key, token, name: undefined };
  }
  return accounts;
}

export async function identify(accounts) {
  for (const account of Object.values(accounts)) {
    const res = await api({ token: account.token, path: "/api/account" });
    if (!res.ok) throw new Error(`Account ${account.key}: GET /api/account returned ${res.status}. Is the token valid?`);
    account.name = res.json.username;
    account.profile = {
      createdAt: res.json.createdAt,
      title: res.json.title,
      disabled: res.json.disabled,
      tosViolation: res.json.tosViolation,
    };
  }
  return accounts;
}

export function save(name, data) {
  const dir = join(here, "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), ...data }, null, 2));
}
