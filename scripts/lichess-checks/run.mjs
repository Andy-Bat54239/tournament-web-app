// Lichess verification checks (brief, section 8). Run:
//   node scripts/lichess-checks/run.mjs <command>
// See README.md in this folder for the accounts and tokens it needs.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  api,
  calls,
  identify,
  loadAccounts,
  RateLimited,
  REQUIRED_SCOPES,
  sampleStream,
  save,
  sleep,
} from "./client.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const findings = [];

function check(name, pass, detail = "") {
  findings.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return pass;
}

function note(label, value) {
  console.log(`INFO  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  findings.push({ name: label, info: value });
}

async function needAccounts(...keys) {
  const accounts = loadAccounts();
  const missing = keys.filter((key) => !accounts[key]);
  if (missing.length) {
    console.error(`Missing token for account ${missing.join(", ")}. See scripts/lichess-checks/README.md.`);
    process.exit(2);
  }
  await identify(accounts);
  return accounts;
}

// Lichess helpers

async function openChallenge(creator, { users, clock = [300, 2], rules, expiresInMs, name = "CC api check" } = {}) {
  const res = await api({
    token: creator?.token,
    method: "POST",
    path: "/api/challenge/open",
    form: {
      "clock.limit": clock[0],
      "clock.increment": clock[1],
      rated: "false",
      users,
      rules,
      name,
      expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
    },
    allow429: true,
  });
  return { res, id: res.json?.challenge?.id ?? res.json?.id };
}

const accept = (who, id, color) =>
  api({ token: who?.token, method: "POST", path: `/api/challenge/${id}/accept`, query: color ? { color } : undefined });
const cancel = (who, id) => api({ token: who.token, method: "POST", path: `/api/challenge/${id}/cancel`, allow429: true });
const show = (who, id) => api({ token: who.token, path: `/api/challenge/${id}/show` });
const move = (who, id, uci) => api({ token: who.token, method: "POST", path: `/api/board/game/${id}/move/${uci}` });
const board = (who, id, action) => api({ token: who.token, method: "POST", path: `/api/board/game/${id}/${action}` });
const exportGame = (id) =>
  api({ path: `/game/export/${id}`, query: { moves: true, clocks: false, evals: false, opening: false, division: false, tags: false } });

const names = (...accounts) => accounts.map((a) => a.name).join(",");

/** White's remaining time in ms, from the first events of the Board API game stream. */
async function whiteClock(who, id) {
  const stream = await sampleStream({ token: who.token, path: `/api/board/game/stream/${id}`, ms: 1500 });
  const events = stream.lines.map((line) => JSON.parse(line));
  const latest = events.filter((e) => e.type === "gameState").pop() ?? events.find((e) => e.type === "gameFull");
  return (latest?.state ?? latest)?.wtime;
}

function summarize(game) {
  if (!game) return null;
  return {
    status: game.status,
    winner: game.winner ?? null,
    rated: game.rated,
    speed: game.speed,
    perf: game.perf,
    white: game.players?.white?.user?.name,
    black: game.players?.black?.user?.name,
    plies: game.moves ? game.moves.split(" ").length : 0,
  };
}

async function waitForEnd(id, maxMs, everyMs = 3000) {
  const deadline = Date.now() + maxMs;
  let last;
  while (Date.now() < deadline) {
    last = (await exportGame(id)).json;
    if (last && !["created", "started"].includes(last.status)) return last;
    await sleep(everyMs);
  }
  return last;
}

/** A (white) and B (black) both join a restricted open challenge. Returns the game id. */
async function startGame({ A, B }, { clock, rules } = {}) {
  const { res, id } = await openChallenge(A, { users: names(A, B), clock, rules, expiresInMs: 10 * 60_000 });
  if (!id) throw new Error(`Could not create challenge: ${res.status} ${res.raw.slice(0, 200)}`);
  const first = await accept(A, id);
  const second = await accept(B, id);
  if (!first.ok || !second.ok) {
    throw new Error(`Accept failed: A ${first.status} ${first.raw.slice(0, 120)} | B ${second.status} ${second.raw.slice(0, 120)}`);
  }
  return id;
}

// Commands

async function smoke() {
  const user = await api({ path: "/api/user/lichess" });
  check("public API reachable", user.ok && user.json?.id === "lichess", `status ${user.status}`);
  note("username vs id", { username: user.json?.username, id: user.json?.id });
  note("rate-limit headers on a normal response", user.rateHeaders);
  const bogus = await api({ method: "POST", path: "/api/token/test", text: "lip_this_is_not_a_real_token" });
  check("token/test returns null for an invalid token", bogus.ok && Object.values(bogus.json ?? {})[0] === null, `status ${bogus.status}`);
}

async function preflight() {
  const accounts = loadAccounts();
  const keys = Object.keys(accounts);
  if (keys.length === 0) {
    console.error("No tokens found. Create scripts/lichess-checks/.env.local from .env.example.");
    process.exit(2);
  }
  const tested = await api({ method: "POST", path: "/api/token/test", text: keys.map((k) => accounts[k].token).join(",") });
  check("token/test answered", tested.ok, `status ${tested.status}`);
  for (const key of keys) {
    const info = tested.json?.[accounts[key].token];
    if (!check(`${key}: token is valid`, Boolean(info))) continue;
    const scopes = info.scopes ? info.scopes.split(",") : [];
    const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
    check(`${key}: has every required scope`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : scopes.join(", "));
    note(`${key}: token expires`, info.expires ? new Date(info.expires).toISOString() : "never");
  }
  await identify(accounts);
  check("A, B and C are three different accounts", new Set(keys.map((k) => accounts[k].name?.toLowerCase())).size === 3 || keys.length < 3);
  for (const key of keys) {
    const { name, profile } = accounts[key];
    note(`${key}: username`, name);
    note(`${key}: account created`, profile.createdAt ? new Date(profile.createdAt).toISOString() : "unknown");
    check(`${key}: account is in good standing`, !profile.disabled && !profile.tosViolation);
  }

  // Team lookup is public, by team id (the last part of the team's web address).
  const teamId = process.argv[3];
  if (teamId) {
    const team = await api({ path: `/api/team/${teamId}` });
    if (check("the test team exists", team.ok, `status ${team.status}`)) {
      note("team", { id: team.json.id, name: team.json.name, open: team.json.open, leader: team.json.leader?.name, members: team.json.nbMembers });
      const list = await api({ path: `/api/team/${teamId}/users`, accept: "application/x-ndjson" });
      const members = list.raw.split("\n").filter(Boolean).map((line) => JSON.parse(line).username.toLowerCase());
      for (const key of keys) check(`${key} (${accounts[key].name}) is a member of the team`, members.includes(accounts[key].name.toLowerCase()));
    }
  }
}

/** Check 1: only the two named players can join; anyone else is refused. */
async function restrictedLink() {
  const { A, B, C } = await needAccounts("A", "B", "C");
  const { res, id } = await openChallenge(A, { users: names(A, B), expiresInMs: 10 * 60_000 });
  if (!check("restricted open challenge created", Boolean(id), `status ${res.status}`)) return;
  note("create response", res.json);

  const anonymous = await accept(undefined, id);
  check("a logged-out request cannot join", !anonymous.ok, `status ${anonymous.status} ${anonymous.raw.slice(0, 100)}`);
  const outsider = await accept(C, id);
  check("account C (not named) cannot join", !outsider.ok, `status ${outsider.status} ${outsider.raw.slice(0, 100)}`);
  const outsiderColor = await accept(C, id, "white");
  check("account C cannot join by asking for a colour either", !outsiderColor.ok, `status ${outsiderColor.status}`);

  const state = await show(A, id);
  note("challenge status after the refused attempts", state.json?.status ?? state.status);
  const game = await exportGame(id);
  check("no game was created by those attempts", game.status === 404, `export status ${game.status}`);

  const first = await accept(A, id);
  const second = await accept(B, id);
  check("A and B can both join (positive control)", first.ok && second.ok, `A ${first.status}, B ${second.status}`);
  await sleep(1500);
  const started = summarize((await exportGame(id)).json);
  note("game after A and B joined", started);
  check("white is the first username in `users`", started?.white === A.name, `white ${started?.white}`);
  await board(A, id, "abort");

  // Does the username match ignore case? Our app will pass the names Lichess gave us, but it is good to know.
  const lower = await openChallenge(A, { users: `${A.name.toLowerCase()},${B.name.toLowerCase()}`, expiresInMs: 5 * 60_000 });
  if (lower.id) {
    const joined = await accept(B, lower.id);
    check("usernames in `users` are matched ignoring case", joined.ok, `status ${joined.status}`);
    await board(B, lower.id, "abort");
  }
}

/** Check 1, browser half: the real link a player would tap. Needs a person in a browser. */
async function manualLink() {
  const stateFile = join(here, "results", "manual-link.json");
  const step = process.argv[3];
  if (step === "create") {
    const { A, B } = await needAccounts("A", "B");
    const { res, id } = await openChallenge(A, { users: names(A, B), expiresInMs: 45 * 60_000 });
    if (!id) throw new Error(`Could not create the challenge: ${res.status} ${res.raw.slice(0, 200)}`);
    save("manual-link", { id, a: A.name, b: B.name });
    console.log(`\nOpen this link as an account that is NOT named in the challenge, and as a logged-out visitor:\n  https://lichess.org/${id}\n`);
    console.log("Do not click it as the two named accounts. Then run: node scripts/lichess-checks/run.mjs manual-link verify");
  } else if (step === "verify") {
    if (!existsSync(stateFile)) throw new Error("Run `manual-link create` first.");
    const { id, a, b } = JSON.parse(readFileSync(stateFile, "utf8"));
    const { A } = await needAccounts("A");
    const state = await show(A, id);
    note("challenge status", state.json?.status ?? state.status);
    const game = await exportGame(id);
    if (game.status === 404) check("nobody got into a game through the link", true, "no game exists for this id");
    else check("only the two named players are in the game", [summarize(game.json)?.white, summarize(game.json)?.black].every((n) => [a, b].includes(n)), JSON.stringify(summarize(game.json)));
    await cancel(A, id);
  } else {
    console.log("Usage: manual-link create | manual-link verify");
  }
}

/** Check 2: how long a challenge stays valid if nobody joins. */
async function expiry() {
  const { A, B } = await needAccounts("A", "B");
  const short = await openChallenge(A, { users: names(A, B), expiresInMs: 60_000 });
  if (!check("challenge with expiresAt = now + 60s created", Boolean(short.id), `status ${short.res.status}`)) return;
  note("response fields", Object.keys(short.res.json ?? {}));
  const before = await show(A, short.id);
  note("challenge JSON while open", before.json);

  console.log("Waiting 75 seconds for it to expire...");
  await sleep(75_000);
  const after = await show(A, short.id);
  note("challenge JSON after expiry", after.json ?? after.raw.slice(0, 200));
  const late = await accept(B, short.id);
  check("a challenge cannot be joined after it expires", !late.ok, `status ${late.status} ${late.raw.slice(0, 100)}`);

  const normal = await openChallenge(A, { users: names(A, B) });
  const details = (await show(A, normal.id)).json;
  note("default challenge, expiry fields", { expiresAt: details?.expiresAt, status: details?.status });
  if (details?.expiresAt) {
    const hours = (details.expiresAt - Date.now()) / 3_600_000;
    check("default expiry is about 24 hours", hours > 23 && hours <= 24.1, `${hours.toFixed(1)} hours`);
  }
  await cancel(A, normal.id);
}

/** Check 4: which `rules` are accepted and which actually block something. */
async function options() {
  const { A, B } = await needAccounts("A", "B");
  const users = names(A, B);

  const noAbort = await openChallenge(A, { users, rules: "noAbort", expiresInMs: 5 * 60_000 });
  check("noAbort is refused for ordinary accounts", !noAbort.id, `status ${noAbort.res.status} ${noAbort.res.raw.slice(0, 160)}`);

  const combined = await openChallenge(A, { users, rules: "noRematch,noGiveTime,noClaimWin,noEarlyDraw", expiresInMs: 5 * 60_000 });
  check("comma-separated rules are accepted", Boolean(combined.id), `status ${combined.res.status} ${combined.res.raw.slice(0, 160)}`);
  if (combined.id) await cancel(A, combined.id);

  // The API answers {"ok":true} either way, so measure White's clock before and after.
  for (const rules of ["noGiveTime", undefined]) {
    const id = await startGame({ A, B }, { rules });
    await move(A, id, "e2e4");
    const before = await whiteClock(B, id);
    const gift = await api({ token: B.token, method: "POST", path: `/api/round/${id}/add-time/15` });
    const added = (await whiteClock(B, id)) - before;
    note(`add-time API with ${rules ?? "no rules"}`, { status: gift.status, addedMs: added });
    if (!rules) check("control: the add-time API adds time without the rule", added >= 15_000, `added ${added} ms`);
    await board(A, id, "abort");
  }

  for (const [label, rules] of [["with noEarlyDraw", "noEarlyDraw"], ["control, no rules", undefined]]) {
    const id = await startGame({ A, B }, { rules });
    await move(A, id, "e2e4");
    await move(B, id, "e7e5");
    const offer = await board(A, id, "draw/yes");
    const agree = await board(B, id, "draw/yes");
    await sleep(1500);
    const game = summarize((await exportGame(id)).json);
    note(`draw offered after 2 plies, ${label}`, { offer: offer.status, agree: agree.status, game });
    if (rules) check("noEarlyDraw stops a draw after two plies", game?.status === "started", `status ${game?.status}`);
    else check("control: an early draw is allowed without the rule", game?.status === "draw", `status ${game?.status}`);
    if (game?.status === "started") await board(A, id, "resign");
  }
  note("not tested here", "noRematch (no rematch endpoint in the API; check the Rematch button by hand) and noClaimWin (needs a disconnect)");
}

/** Checks 3 and 7: how a finished game reports its result, and that 5+2 is blitz. */
async function results() {
  const { A, B } = await needAccounts("A", "B");
  const pair = { A, B };
  const scenarios = [
    { key: "checkmate", play: async (id) => { await move(A, id, "f2f3"); await move(B, id, "e7e5"); await move(A, id, "g2g4"); await move(B, id, "d8h4"); } },
    { key: "resignation", play: async (id) => { await move(A, id, "e2e4"); await board(B, id, "resign"); } },
    { key: "draw-by-agreement", play: async (id) => { await move(A, id, "e2e4"); await move(B, id, "e7e5"); await board(A, id, "draw/yes"); await board(B, id, "draw/yes"); } },
    { key: "abort-before-moves", play: async (id) => { await board(A, id, "abort"); } },
    { key: "blitz-5+2-classification", play: async (id) => { await board(A, id, "abort"); } },
    { key: "clock-runs-out", clock: [15, 0], wait: 60_000, play: async (id) => { await move(A, id, "e2e4"); await move(B, id, "e7e5"); } },
    { key: "white-never-moves", clock: [15, 0], wait: 120_000, play: async () => {} },
    { key: "black-never-moves", clock: [15, 0], wait: 120_000, play: async (id) => { await move(A, id, "e2e4"); } },
  ];

  const out = {};
  for (const scenario of scenarios) {
    try {
      const id = await startGame(pair, { clock: scenario.clock });
      await scenario.play(id);
      const game = await waitForEnd(id, scenario.wait ?? 15_000, 2_000);
      out[scenario.key] = { id, ...summarize(game) };
      note(scenario.key, out[scenario.key]);
      if (!["created", "started"].includes(game?.status)) continue;
      check(`${scenario.key}: game reached a final status`, false, `still ${game?.status}`);
      await board(A, id, "resign");
    } catch (error) {
      if (error instanceof RateLimited) throw error;
      check(`${scenario.key}: ran`, false, error.message);
    }
  }

  const blitz = out["blitz-5+2-classification"];
  check("5+2 is classed as blitz by Lichess", blitz?.speed === "blitz" && blitz?.perf === "blitz", `speed ${blitz?.speed}, perf ${blitz?.perf}`);
  check("games are unrated", Object.values(out).every((g) => g.rated === false));
  save("results-games", out);
}

/** Check 8: how much the API tolerates at 64-player scale, one request at a time. */
async function rateLimits() {
  const { A, B, C } = await needAccounts("A", "B", "C");
  const users = names(A, B);

  const made = [];
  let stoppedAt = null;
  for (let i = 0; i < 60; i++) {
    const { res, id } = await openChallenge(A, { users, expiresInMs: 15 * 60_000 });
    if (res.status === 429 || !id) {
      stoppedAt = { after: made.length, status: res.status, body: res.raw.slice(0, 200), headers: res.rateHeaders };
      break;
    }
    made.push(id);
  }
  check("created 60 restricted challenges in a row without a 429", made.length === 60, stoppedAt ? JSON.stringify(stoppedAt) : "");
  note("challenges created", made.length);

  let cancelled = 0;
  for (const id of made) {
    const res = await cancel(A, id);
    if (res.status === 429) {
      note("cancel hit a 429 after", cancelled);
      break;
    }
    cancelled += 1;
  }
  note("challenges cancelled (the rest expire in 15 minutes)", cancelled);

  let limited = 0;
  for (let i = 0; i < 64; i++) {
    const res = await api({ path: `/api/user/${A.name}`, allow429: true });
    if (res.status === 429) {
      limited = i;
      break;
    }
  }
  check("64 reads of a user profile in a row without a 429", limited === 0, limited ? `429 after ${limited}` : "");

  const stream = await sampleStream({
    method: "POST",
    path: "/api/stream/games-by-users",
    text: names(A, B, C),
    ms: 6_000,
  });
  check("the games-by-users stream opens", stream.status === 200, `status ${stream.status} ${stream.raw ?? ""}`);
  note("stream rate headers", stream.rateHeaders);
  const second = await api({ token: A.token, path: "/api/account", allow429: true });
  check("an ordinary request still works after a stream", second.ok, `status ${second.status}`);
}

const commands = {
  smoke,
  preflight,
  "restricted-link": restrictedLink,
  "manual-link": manualLink,
  expiry,
  options,
  results,
  "rate-limits": rateLimits,
};

const name = process.argv[2];
if (!commands[name]) {
  console.log(`Usage: node scripts/lichess-checks/run.mjs <${Object.keys(commands).join(" | ")}>`);
  process.exit(name ? 1 : 0);
}

try {
  await commands[name]();
} catch (error) {
  console.error(`\n${error instanceof RateLimited ? "STOPPED" : "ERROR"}: ${error.message}`);
  process.exitCode = 1;
} finally {
  save(name, { findings, calls });
  const failed = findings.filter((f) => f.pass === false).length;
  console.log(`\n${findings.filter((f) => f.pass !== undefined).length - failed} passed, ${failed} failed. Raw results: scripts/lichess-checks/results/${name}.json`);
}
