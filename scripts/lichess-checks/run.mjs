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
      const members = list.raw.split("\n").filter(Boolean).map((line) => JSON.parse(line).name.toLowerCase());
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
  // Its own file: every command saves its findings to <command>.json at the end, which would overwrite the id.
  const stateFile = join(here, "results", "manual-link-state.json");
  const step = process.argv[3];
  if (step === "create") {
    const { A, B } = await needAccounts("A", "B");
    const { res, id } = await openChallenge(A, { users: names(A, B), expiresInMs: 45 * 60_000 });
    if (!id) throw new Error(`Could not create the challenge: ${res.status} ${res.raw.slice(0, 200)}`);
    save("manual-link-state", { id, a: A.name, b: B.name });
    console.log(`\nOpen this link as an account that is NOT named in the challenge, and as a logged-out visitor:\n  https://lichess.org/${id}\n`);
    console.log("Do not click it as the two named accounts. Then run: node scripts/lichess-checks/run.mjs manual-link verify");
  } else if (step === "verify") {
    if (!existsSync(stateFile)) throw new Error("Run `manual-link create` first.");
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    const id = process.argv[4] ?? saved.id;
    const { a, b } = saved;
    if (!id) throw new Error("No challenge id. Run `manual-link create`, or pass the id: manual-link verify <id>.");
    const { A } = await needAccounts("A");
    const state = await show(A, id);
    check("the challenge was found", state.ok, `status ${state.status}`);
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
    { key: "resignation", play: async (id) => { await move(A, id, "e2e4"); await move(B, id, "e7e5"); await board(B, id, "resign"); } },
    // Lichess treats a resignation before both players have moved as an abort.
    { key: "resign-before-both-moved", play: async (id) => { await move(A, id, "e2e4"); await board(B, id, "resign"); } },
    { key: "draw-by-agreement", play: async (id) => { await move(A, id, "e2e4"); await move(B, id, "e7e5"); await board(A, id, "draw/yes"); await board(B, id, "draw/yes"); } },
    { key: "abort-before-moves", play: async (id) => { await board(A, id, "abort"); } },
    { key: "blitz-5+2-classification", play: async (id) => { await board(A, id, "abort"); } },
    // Timeouts and no-shows are in the `timeouts` command. The Board API cannot play ultrabullet (15s) games.
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

/**
 * Checks 3 and 6, game side: does Lichess end a game by itself when a clock runs out or a player never moves?
 * Blitz clocks only (1+3), because the Board API refuses anything faster. Each case runs twice: with both
 * players holding the game stream open, like a browser tab, and API-only, with nobody connected.
 */
async function timeouts() {
  const { A, B } = await needAccounts("A", "B");
  const FINAL = ["aborted", "mate", "resign", "draw", "outoftime", "timeout", "noStart", "stalemate", "cheat", "unknownFinish"];
  const waitMs = 130_000;
  const plans = [
    { key: "clock runs out", moves: [[A, "e2e4"], [B, "e7e5"]] },
    { key: "nobody moves", moves: [] },
    { key: "Black silent after 1.e4", moves: [[A, "e2e4"]] },
  ].flatMap((plan) => [{ ...plan, connected: true }, { ...plan, connected: false }]);

  const games = [];
  for (const plan of plans) {
    const id = await startGame({ A, B }, { clock: [60, 3] });
    games.push({ ...plan, id, streams: [] });
  }
  for (const game of games.filter((g) => g.connected)) {
    for (const who of [A, B]) game.streams.push(sampleStream({ token: who.token, path: `/api/board/game/stream/${game.id}`, ms: waitMs + 5_000 }));
  }
  await sleep(2_000);
  for (const game of games) for (const [who, uci] of game.moves) await move(who, game.id, uci);

  const started = Date.now();
  const ended = new Map();
  while (Date.now() - started < waitMs && ended.size < games.length) {
    await sleep(10_000);
    for (const game of games.filter((g) => !ended.has(g.id))) {
      const result = summarize((await exportGame(game.id)).json);
      if (result && FINAL.includes(result.status)) ended.set(game.id, { ...result, afterSeconds: Math.round((Date.now() - started) / 1000) });
    }
  }
  for (const game of games) {
    const result = ended.get(game.id);
    note(`${game.key}, ${game.connected ? "players connected" : "API only"}`, result ?? `not finished after ${waitMs / 1000}s`);
    if (!result) {
      await board(A, game.id, "abort");
      await board(A, game.id, "resign");
    }
  }
  const flagged = (connected) => ended.get(games.find((g) => g.key === "clock runs out" && g.connected === connected).id);
  check("a connected player's clock running out ends the game", flagged(true)?.status === "outoftime", flagged(true)?.status ?? "not finished");
  note("an API-only game is flagged", Boolean(flagged(false)));
  save("timeouts", { games: games.map(({ streams, ...g }) => ({ ...g, moves: g.moves.length, ended: ended.get(g.id) ?? null })) });
}

/** Check 8: how much the API tolerates at 64-player scale, one request at a time. */
async function rateLimits() {
  const { A, B, C } = await needAccounts("A", "B");
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
    text: [...new Set([A, B, C].filter(Boolean).map((account) => account.name))].join(","),
    ms: 6_000,
  });
  check("the games-by-users stream opens", stream.status === 200, `status ${stream.status} ${stream.raw ?? ""}`);
  note("stream rate headers", stream.rateHeaders);
  const second = await api({ token: A.token, path: "/api/account", allow429: true });
  check("an ordinary request still works after a stream", second.ok, `status ${second.status}`);
}


// Swiss checks. Usage: run.mjs swiss-no-show [teamId]
// Three accounts in a 3-round team Swiss on blitz 1+3, unrated. The Board API refuses tournament games
// ("This game cannot be played with the Board API"), so no moves can be made: this only watches what
// Lichess does by itself when nobody moves.

const swissTeam = () => process.argv[3] ?? "ccug-test-team";
const swissInfo = (id) => api({ path: `/api/swiss/${id}` });

async function swissStandings(id) {
  const res = await api({ path: `/api/swiss/${id}/results`, accept: "application/x-ndjson" });
  return res.raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Pairs of our test accounts that are playing each other in this Swiss right now. */
async function swissGames(players, swissId) {
  const games = new Map();
  for (const who of players) {
    // The default list is 9 long and "most urgent first", so ask for the maximum.
    const res = await api({ token: who.token, path: "/api/account/playing", query: { nb: 50 } });
    for (const game of (res.json?.nowPlaying ?? []).filter((g) => g.swissId === swissId)) {
      const entry = games.get(game.gameId) ?? { id: game.gameId };
      entry[game.color] = who;
      games.set(game.gameId, entry);
    }
  }
  return [...games.values()].filter((g) => g.white && g.black);
}

async function createAndJoinSwiss(players, name) {
  const [A] = players;
  const created = await api({
    token: A.token,
    method: "POST",
    path: `/api/swiss/new/${swissTeam()}`,
    form: {
      name,
      "clock.limit": 60,
      "clock.increment": 3,
      nbRounds: 3,
      startsAt: Date.now() + 90_000,
      roundInterval: 10,
      rated: "false",
      "conditions.allowList": players.map((p) => p.name).join(","),
      description: "Automated API check. Unrated.",
    },
    allow429: true,
  });
  if (!check("a Swiss can be created inside the team", Boolean(created.ok && created.json?.id), `status ${created.status} ${created.raw.slice(0, 240)}`)) return null;
  note("Swiss create response fields", Object.keys(created.json));
  for (const who of players) {
    const joined = await api({ token: who.token, method: "POST", path: `/api/swiss/${created.json.id}/join` });
    check(`${who.key} (${who.name}) joined the Swiss`, joined.ok, `status ${joined.status} ${joined.raw.slice(0, 120)}`);
  }
  return created.json.id;
}

/** Watches rounds as they appear. `onGame(game, round, earlier)` handles one game and returns what to record. */
async function runSwiss(id, players, onGame, deadlineMs = 20 * 60_000) {
  const handled = new Set();
  const rounds = [];
  let lastRound = 0;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const info = (await swissInfo(id)).json;
    if (info?.status === "finished") return { info, rounds };
    if (info?.round > lastRound && info.nbOngoing > 0) {
      const games = (await swissGames(players, id)).filter((g) => !handled.has(g.id));
      if (games.length > 0) {
        lastRound = info.round;
        const playing = new Set(games.flatMap((g) => [g.white.key, g.black.key]));
        const round = { round: info.round, bye: players.filter((p) => !playing.has(p.key)).map((p) => p.key), games: [] };
        for (const game of games) {
          handled.add(game.id);
          round.games.push(await onGame(game, round, rounds));
        }
        rounds.push(round);
        if (round.games.some((g) => g.stalled)) return { info: (await swissInfo(id)).json, rounds, stalled: true };
      }
    }
    await sleep(5_000);
  }
  return { info: (await swissInfo(id)).json, rounds, timedOut: true };
}

async function finishSwiss(A, id, info) {
  if (info?.status !== "finished") {
    const ended = await api({ token: A.token, method: "POST", path: `/api/swiss/${id}/terminate` });
    note("terminated the unfinished Swiss", { status: ended.status });
  }
}

/** Check 6: nobody moves. How long until Lichess ends the game itself, how it is scored, and who is marked absent. */
async function swissNoShow() {
  const { A, B, C } = await needAccounts("A", "B", "C");
  const players = [A, B, C];
  const id = await createAndJoinSwiss(players, "CC api check: no-show");
  if (!id) return;
  note("Swiss", `https://lichess.org/swiss/${id}`);
  let outcome;
  try {
    outcome = await runSwiss(id, players, async (game) => {
      const started = Date.now();
      const last = await waitForEnd(game.id, 300_000, 5_000);
      const ended = Boolean(last) && !["created", "started"].includes(last.status);
      return { id: game.id, white: game.white.key, black: game.black.key, ended, stalled: !ended, afterSeconds: Math.round((Date.now() - started) / 1000), ...summarize(last) };
    });
    note("rounds", outcome.rounds);
    note("tournament JSON at the end", outcome.info);
    const standings = await swissStandings(id);
    note("standings", standings.map((r) => ({ rank: r.rank, user: r.username, points: r.points, tieBreak: r.tieBreak, performance: r.performance, absent: r.absent })));
    check("Lichess ended the unplayed game by itself", outcome.rounds.length > 0 && !outcome.stalled, outcome.stalled ? "still running after 300 s" : "");
    check("the Swiss ran to the end", outcome.info?.status === "finished", `status ${outcome.info?.status}${outcome.timedOut ? ", timed out" : ""}${outcome.stalled ? ", a game stalled" : ""}`);
  } finally {
    await finishSwiss(A, id, outcome?.info);
  }
}

const commands = {
  smoke,
  preflight,
  "restricted-link": restrictedLink,
  "manual-link": manualLink,
  expiry,
  options,
  results,
  timeouts,
  "swiss-no-show": swissNoShow,
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
