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

**The Swiss view, the cut-off line and the bubble.** While the Swiss is being played the public Bracket page shows
its standings, read from Lichess, and the Organizer page shows the same table under the bracket form. A line marks
the last place that plays on (the top 16, or the top 32 at 64 players, as the field size sets it). Ranks are
Lichess's own and are never worked out here; only players in the tournament are listed. Each row is marked:

- **Through:** certain to play on. **Out:** cannot reach the line any more. These claims are proved from the
  points, not guessed: nobody scores more than a point a round, points never go down, and a tie counts against the
  player because Lichess's tiebreak could go either way. A test plays out thousands of random endings to check that
  neither claim is ever wrong.
- **Bubble:** not decided yet, and within three places of the line or level on points with it. When the Swiss is over
  this is only the players level at the line, labelled **Tiebreak**, and a sentence names who missed the cut on
  Lichess's tiebreak and who made it.

The page brings itself up to date every 30 seconds, for a phone or a projector. The server reads Lichess for it
through one shared reader, not once per viewer: a reading is reused for 20 seconds (5 minutes once the Swiss is
finished), everyone who asks during a read waits for that same read, and after a failure Lichess is left alone (a
minute after an HTTP 429) while the last good reading is shown, marked as from an earlier time. Each server
instance has its own reader, so on serverless hosting expect about one read per instance every 20 seconds. Once the
bracket is built, the standings kept with it are shown under the bracket and Lichess is not asked again. Building the
bracket never uses the shared reader: it reads the final standings from Lichess itself.

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

## Admins

Admins are chosen by the super admin on the Organizer page, per tournament, and stop having access when the
tournament ends (the super admin keeps it). Access is deny-by-default.

- **Add an admin** by their Lichess username. The app checks the name exists on Lichess and uses Lichess's own
  spelling. They start from the referee or the check-in desk ticks.
- **Tick or untick** what each admin may do: results, no-shows and forfeits, the check-in desk, announcements, building
  the bracket, changing the date and rules, reading the audit log. **Use referee ticks** and **Use desk ticks** put
  someone back on a preset; **Remove admin** takes their access away at once.
- **Only the super admin manages admins or ends the tournament.** That is not a tick: no one can be given it, and a
  referee who has been ticked for everything else still cannot add an accomplice.
- Every change is in the audit log with who made it and exactly what was switched on or off.
- The super admin is whoever logs in with the `SUPER_ADMIN` username, so it is not an admin record and cannot be
  removed from the app.

## Round control

Once a bracket is built, the Organizer page has a **Round control** card for anyone with the rounds, results or
forfeit permission. It lists every match of every round and where it stands, and refreshes itself every 15 seconds:

| Stage                       | Meaning                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Needs a referee             | A claim, a waiting time that ran out, an odd result from Lichess, or repeated aborts.         |
| Playing                     | Both players have joined the game on Lichess.                                                |
| Waiting for players         | The waiting time is running, with who is ready and how long is left.                          |
| On hold                     | The players are known, but the knockout has not been started (see below).                    |
| Waiting for earlier matches | The players are not known yet.                                                               |
| Done                        | Decided, with who advanced, how, and the score.                                              |

**Holding the knockout.** The brief runs a 64-player event as the Swiss one Sunday and the knockout the next. If the
bracket were built straight after the Swiss, every first-round match would start its 3-minute clock at once. So the
build form has a **Hold the knockout** tick. A held bracket is public and players see who they play ("The knockout
has not started yet"), but no waiting time runs and nobody can start a game. **Start the knockout** (rounds
permission) gives every ready match its waiting time from that moment. Without the tick, matches open at once, as
before. Referees can still settle a held match by hand. Resetting the bracket clears the hold.

**Round update.** The card writes a message for the community chat, for example "Quarterfinals are live. 1 of 4
matches finished. Still waiting to start: Ivan v Patience, Brian v Sarah." The organizer opens it in WhatsApp,
picks the group and sends it. Nothing is sent by the app.

## Layout

```
src/domain/    The rules. Pure functions, no I/O, no framework.
  bracket.ts     seeding (1 v 16, 8 v 9, ...), byes, round names
  match.ts       two games, game 3, games 4 and 5, higher-seed fallback, colours
  knockout.ts    results -> who plays whom, who advances; rolling bracket; no-shows; overrides
  registration.ts  64 cap, waitlist, check-in, removing no-shows
  schedule.ts    everything worked out from the start time, in East Africa Time
  format.ts      field size -> Swiss rounds and cut-off; seeding for a straight knockout
  cutoff.ts      the cut-off line: who is through, out or on the bubble, and the sentences under the table
  swiss.ts       reading a Swiss link, where it has got to, how many rounds can still change the points
  permissions.ts roles, deny by default
  phone.ts       +256 format check
  play.ts        the waiting windows, Lichess game status -> result, who won given the colours, claim rules
src/server/    store.ts (all state and every change, with permission checks), session.ts
  play.ts        playing a match: ready, the shared Lichess link, reading results, aborts, claims, problems
  match-screen.ts  what each player sees of their match
  swiss.ts       the final standings the bracket is built from; the live Swiss as the pages show it
  swiss-feed.ts  the shared, cached reader of the live Swiss (one read for everyone, backs off after a 429)
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
   after a game ends is also used for games 3 to 5 and for a game that has to be replayed. **Unless the knockout is
   built on hold** (see "Round control"), when no wait runs until an organizer presses Start.
9. **An aborted game counts as not played.** Lichess cannot be told to block aborts, and an early resignation is
   recorded as one. The game is replayed on a new link and both players tap ready again. Two aborts in one match call
   a referee. Joel still has to decide who is at fault and how many are allowed.
10. **Lichess game rules:** `noRematch`, `noGiveTime` and `noEarlyDraw` on, `noClaimWin` off (`GAME_RULES` in
    `src/domain/play.ts`).
11. **A no-show claim needs a referee.** The waiting player taps Claim win, and a referee confirms or turns it down.
    Results are read from Lichess every 8 seconds while a player has the match screen open, and by the background
    pass described under "The Swiss and the results".
12. **"On the bubble" means within three places of the line, or level on points with it**, unless it is already
    certain (through or out). Three is `BUBBLE_SPAN` in `src/domain/cutoff.ts`. The cut-off proofs assume nobody
    scores more than one point a round (a win is one point on Lichess). If a round could be worth more, the
    proofs in `cutOff` would need changing.

## Not built yet

- **Creating the Swiss from the app.** It is created on Lichess by hand for now.
- **Rating snapshot** when sign-ups close, the two-admin edit warning, and data deletion requests.
- **Phase 2:** the standings image, round announcement text, and push notifications.
- **The rules, fair-play and consent wording** (the brief lists it as open). The sign-up checkbox is a placeholder.
- **A wide projector layout** for the public view. It is a single phone-width column today.
