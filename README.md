# Castle Connect UG tournament app

Runs the Sunday tournament on Lichess: sign-up and check-in, a seeded knockout bracket built from the Swiss
standings, no-show rules, and a live public view. The spec is
the Castle Connect UG tournament app brief (version 1, 22 October 2026); the look and rules were first shown in a
clickable prototype. Neither file is in this repository.

**Status: scaffold.** Sign-up, check-in, the bracket and match rules, the schedule, roles and the audit log work
end to end against a *simulated* Lichess and an *in-memory* store. Nothing talks to the real Lichess yet. See
[Not built yet](#not-built-yet).

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
build it with 8 qualifiers. Copy [`.env.example`](.env.example) to change any of this.

## Stack, and why

| Layer     | Choice                                | Why                                                                                              |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| App       | Next.js 16 (App Router), React 19, TS | One codebase for pages, server actions and the Lichess login callbacks. Runs on any Node host.   |
| Rules     | Plain TypeScript in `src/domain`      | Bracket, match, no-show, sign-up and schedule rules with no framework in them. 85 of the tests.  |
| Rendering | Partial Prerender (Cache Components)  | Every page is a static shell with the live part streamed in, which suits phones on mobile data.  |
| Styling   | Plain CSS, brand tokens               | Light pages, no UI library. Emerald, gold and cream, with a dark mode.                            |
| Lichess   | One interface, mock behind it         | The real client slots in after the checks in section 8 of the brief.                              |
| Data      | In-memory `Store` class               | Stand-in for Postgres, so the swap stays in one file.                                             |
| Login     | Signed `httpOnly` cookie              | The username only ever comes from the Lichess login, never from a typed field.                    |
| Tests     | Vitest                                | Fast, no setup, runs the domain code in plain Node.                                               |

**Hosting suggestion (not decided):** Vercel plus a hosted Postgres such as Neon, both of which have free tiers.
Check their current limits against 64 players. The in-memory store must be replaced first, because serverless
instances do not share memory and a restart empties it.

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
src/server/    store.ts (all state and every change, with permission checks), session.ts, lichess/ (mock)
src/app/       pages (/, /bracket, /organizer) and actions.ts (Server Actions)
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

## Not built yet

- **Real Lichess:** OAuth login, reading the Swiss, restricted challenge links, reading results. This waits on the
  verification checks in section 8 of the brief, which need test accounts.
- **A database.** All state is lost when the server restarts.
- **The player match screen:** "I'm ready", the 3-minute countdown, Claim win, Play on Lichess, report a problem. Until
  then, organizers set results by hand, which the brief wants as the fallback anyway.
- **Round control and the Swiss view:** starting rounds, the bubble, matches waiting or flagged.
- **Admin management:** adding admins and ticking their permissions. The roles and checks exist; there is no screen.
- **Rating snapshot** when sign-ups close, the two-admin edit warning, and data deletion requests.
- **Phase 2:** the standings image, round announcement text, and push notifications.
- **The rules, fair-play and consent wording** (the brief lists it as open). The sign-up checkbox is a placeholder.
- **A wide projector layout** for the public view. It is a single phone-width column today.
