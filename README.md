# Castle Connect UG tournament app

Runs the Sunday tournament on Lichess: sign-up and check-in, a seeded knockout bracket built from the Swiss
standings, no-show rules, and a live public view. The spec is
the Castle Connect UG tournament app brief (version 1, 22 October 2026); the look and rules were first shown in a
clickable prototype. Neither file is in this repository.

**Status: scaffold.** Sign-up, check-in, the bracket and match rules, the schedule, roles, the audit log, and the
player match screen with its referee desk work end to end, and the tournament is kept in Postgres, so a restart loses
nothing. Log in with Lichess is the real
OAuth login (`LICHESS_LOGIN=oauth`), and game links and results can talk to the real Lichess (`LICHESS_MODE=live`);
by default both use stand-ins so it runs with no setup. See [Not built yet](#not-built-yet).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm test`          | The rules and store tests (Vitest)            |
| `npm run typecheck` | TypeScript, no emit                           |
| `npm run lint`      | ESLint                                        |
| `npm run build`     | Production build                              |

In development, "Log in with Lichess" is a stand-in: type any username. `Joel` is the super admin, `Ruth_Ref` a
referee, `Dan_Desk` the check-in desk, anyone else a player (try `Mercy_K`, as in the prototype). The demo has 41
players signed up for Sunday 1 November 2026, 14:00. To see a bracket the size of the prototype's, log in as Joel and
build it with 8 qualifiers, then log in as one of the two players of the first match and open **My match**. With the
mock Lichess a development-only panel plays the part of both players (join, win, draw, abort), so every state can be
reached by hand. Copy [`.env.example`](.env.example) to change any of this, including `LICHESS_MODE=live`.

### The real "Log in with Lichess"

Add `LICHESS_LOGIN=oauth` to a git-ignored `.env.local` and restart. The login card becomes one button that sends the
person to Lichess and back; the typed-username form is gone, and the server refuses it even if called directly.
Nothing is registered with Lichess. The app asks for **no permissions**, only for who the person is, and revokes the
token the moment it has the username, so it never keeps one.

In production, set `DATABASE_URL`, `CRON_SECRET` (or `BACKGROUND_SYNC=true`), `APP_URL` (https, no path), `SESSION_SECRET`, `LICHESS_MODE=live`, `LICHESS_SERVICE_TOKEN`, and
`SUPER_ADMIN` as **Joel's real Lichess username**, because the super admin is whoever logs in with that name.

To run the checks against the real Lichess with the throwaway test accounts (skipped by default):

```bash
LICHESS_LIVE_TESTS=1 npx vitest run src/server/lichess/http.live.test.ts
```

## Stack, and why

| Layer     | Choice                                | Why                                                                                              |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| App       | Next.js 16 (App Router), React 19, TS | One codebase for pages, server actions and the Lichess login callbacks. Runs on any Node host.   |
| Rules     | Plain TypeScript in `src/domain`      | Bracket, match, no-show, sign-up and schedule rules with no framework in them. 100+ of the tests. |
| Rendering | Partial Prerender (Cache Components)  | Every page is a static shell with the live part streamed in, which suits phones on mobile data.  |
| Styling   | Plain CSS, brand tokens               | Light pages, no UI library. Emerald, gold and cream, with a dark mode.                            |
| Lichess   | One interface; a mock and a live client | Develop and demo on the mock, run a real event on the live client (`LICHESS_MODE=live`).        |
| Data      | Postgres: one versioned JSON document | `pg` in production, PGlite (real Postgres in a folder) locally. Saves are checked, see below.      |
| Login     | Signed `httpOnly` cookie              | The username only ever comes from the Lichess login, never from a typed field.                    |
| Tests     | Vitest                                | Fast, no setup, runs the domain code in plain Node.                                               |

**Hosting suggestion (not decided):** Vercel plus a hosted Postgres such as Neon, both of which have free tiers.
Check their current limits against 64 players. Set `DATABASE_URL` to the Postgres address; nothing else is needed.

## The database

The whole tournament (players, bracket, results, matches in play, admins, audit log) is one JSON document in a
Postgres table, `tournament_state`, with a version number. It is made on first use, so there is nothing to migrate.

- **Production:** set `DATABASE_URL` (for example the connection string from Neon). Without it the app refuses to
  start in production, so an event is never run on a database that is not kept safe.
- **Development and tests:** with no `DATABASE_URL`, the app uses PGlite, a real Postgres engine in a folder
  (`.data/pglite`, or `PGLITE_DIR`). It keeps data across restarts with nothing to install. `npm run db:reset` clears it.
  Only one process can use that folder at a time.
- **Two things changing at once are both kept.** Pages read a copy of the state. Every change goes through
  `updateStore` (`src/server/provider.ts`), which saves only if nobody else saved since it read, and otherwise runs the
  change again on the newer state. Changes that did nothing (a poll that found no news) save nothing. A change that
  gives up after six tries tells the person to try again.
- **`TOURNAMENT_START`, `TOURNAMENT_CAP` and `SEED_DEMO`** only decide how the tournament starts the first time the
  app runs against an empty database. After that the saved tournament wins, and the start time is changed in the app.
- **Why one document and not many tables:** one event, 64 players, and every change touches several things that must
  agree. A single versioned save makes that simple and safe. Splitting it into tables is possible later if a reason
  appears (for example reporting across events).
- **Tests:** the repository tests run on PGlite and on the `pg` driver over the real Postgres protocol. To run them
  against a real server too: `DATABASE_TEST_URL=postgres://... npm test`.

## The Swiss and the results

**The Swiss.** Lichess runs the Swiss, as the brief says. Joel (or another leader of the Castle Connect team)
creates it on Lichess, inside the team, with the signed-up players allowed in. In the app, an organizer with the
*rounds* permission pastes the Swiss link into the box on the Organizer page. The app checks with Lichess that it
exists, shows how far it has got ("Round 3 of 5, 14 games still being played"), and logs who chose it.
**Build the bracket only works once Lichess says the Swiss has finished**, and then takes the final ranks exactly as
Lichess gives them, tiebreak included. It refuses a Swiss that none of the checked-in players entered, and a straight
knockout (16 players or fewer) needs no Swiss at all. With the stand-in Lichess no Swiss has to be chosen and the
standings are invented. Creating the Swiss from the app is not built: it would need a team leader's token with the
`team:write` scope, and the service token only has the two challenge scopes.

**Reading results without anyone looking.** While a player has the match screen open it reads their game every few
seconds. Games that end when nobody has the page open are read by a separate pass, which looks up every match with a
game link out, one at a time, and records finished games, aborts and odd results exactly as the match screen does.
It stops at once if Lichess answers HTTP 429. Switch it on one of two ways:

- **A host that keeps running** (a VPS, Fly, Railway, `next start`): set `BACKGROUND_SYNC=true`. The server then reads
  every `SYNC_EVERY_SECONDS` (20 unless set, never under 5). Do not use this on serverless hosting.
- **Any host, including Vercel:** set `CRON_SECRET` to a long random string and have something call
  `GET /api/sync` every minute with `Authorization: Bearer <that string>`. Vercel Cron sends that header by itself, but
  the free plan only runs it once a day, so use a free pinger such as cron-job.org, or GitHub Actions (every 5
  minutes at best). The address answers 503 until `CRON_SECRET` is set and 401 to anyone without it. It returns
  `{"checked":2,"changed":1,"stopped":null,"failed":0}`.

Even with neither, nothing is lost: a result is picked up when a player opens the match screen or a referee sets it.

## Layout

```
src/domain/    The rules. Pure functions, no I/O, no framework.
  bracket.ts     seeding (1 v 16, 8 v 9, ...), byes, round names
  match.ts       two games, game 3, games 4 and 5, higher-seed fallback, colours
  knockout.ts    results -> who plays whom, who advances; rolling bracket; no-shows; overrides
  registration.ts  64 cap, waitlist, check-in, removing no-shows
  schedule.ts    everything worked out from the start time, in East Africa Time
  format.ts      field size -> Swiss rounds and cut-off; seeding for a straight knockout
  permissions.ts roles, deny by default
  phone.ts       +256 format check
  play.ts        the waiting windows, Lichess game status -> result, who won given the colours, claim rules
src/server/    store.ts (all state and every change, with permission checks), session.ts
  play.ts        playing a match: ready, the shared Lichess link, reading results, aborts, claims, problems
  match-screen.ts  what each player sees of their match
  oauth.ts       PKCE, the authorize address, the code exchange, the account lookup, revoking the token
  login.ts       the two halves of a login: start it, and finish it (state check, closed accounts)
  auth-config.ts which login is in use, and the app's own public address
  lichess/       the interface, a mock (with a simulator), and the live client (http.ts)
src/app/       pages (/, /bracket, /match, /organizer, /login/error), api/auth/lichess (the login routes)
               and actions.ts (Server Actions)
src/components/
```

## Assumptions to confirm with Joel

These fill gaps in the brief. Each is one constant or one line, so they are cheap to change.

1. **Sign-ups close at midnight (East Africa Time) at the start of the start date**, for "the night before".
2. **Check-in closes 15 minutes before the start** (from the sample timeline). Withdrawals are open until then, or
   after a schedule change, but never once the bracket is built.
3. **Field size:** up to 16 players is a straight knockout seeded by Lichess rating (the brief's suggested default);
   17 to 32 is 5 Swiss rounds and the top 16; 33 to 64 is 6 rounds (assumed) and the top 32.
4. **The higher seed has White in game 1**, then colours alternate.
5. **A no-show in any game forfeits the match**, using the game 2 window from the brief.
6. **The super admin keeps access after the tournament ends**; admins do not. The fair-play review runs for 24 hours
   afterwards.
7. **Waitlisted players who get promoted still have to check in**; the desk can check them in.
8. **The first 3-minute wait starts the moment a match becomes ready**, because the bracket rolls. The 2-minute wait
   after a game ends is also used for games 3 to 5 and for a game that has to be replayed.
9. **An aborted game counts as not played.** Lichess cannot be told to block aborts, and an early resignation is
   recorded as one. The game is replayed on a new link and both players tap ready again. Two aborts in one match call
   a referee. Joel still has to decide who is at fault and how many are allowed.
10. **Lichess game rules:** `noRematch`, `noGiveTime` and `noEarlyDraw` on, `noClaimWin` off (`GAME_RULES` in
    `src/domain/play.ts`).
11. **A no-show claim needs a referee.** The waiting player taps Claim win, and a referee confirms or turns it down.
    Results are read from Lichess every 8 seconds while a player has the match screen open, and by the background
    pass described under "The Swiss and the results".

## Not built yet

- **The Swiss mirror:** live standings and round status on the public page while the Swiss is being played (the
  organizer can see the round, the public cannot yet), and the cut-off line and bubble.
- **Creating the Swiss from the app.** It is created on Lichess by hand for now.
- **Round control:** starting rounds, matches waiting or flagged.
- **Admin management:** adding admins and ticking their permissions. The roles and checks exist; there is no screen.
- **Rating snapshot** when sign-ups close, the two-admin edit warning, and data deletion requests.
- **Phase 2:** the standings image, round announcement text, and push notifications.
- **The rules, fair-play and consent wording** (the brief lists it as open). The sign-up checkbox is a placeholder.
- **A wide projector layout** for the public view. It is a single phone-width column today.
