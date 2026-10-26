# Lichess checks (brief, section 8)

Status as of 26 October 2026. "Docs" means Lichess's own API spec
([lichess-org/api](https://github.com/lichess-org/api/tree/master/doc/specs), which is what lichess.org/api is built
from). "Source" means the Lichess server code ([lichess-org/lila](https://github.com/lichess-org/lila)). "Live" means
run against real Lichess with throwaway test accounts, using `scripts/lichess-checks`. The brief planned to rely on
third-party library docs; these are the primary sources.

| # | Check | Status | Finding |
| - | ----- | ------ | ------- |
| 1 | Restricted link refuses a third account | **Verified live (API); browser half pending** | Account C (not named) and a logged-out request were both refused with "The challenge is not for you to accept", asking for a colour did not get round it, and no game was created. A and B could join, and the first name listed had White. Usernames match ignoring case. Still to do: open the real link in a browser as C and logged out. |
| 2 | How long an unjoined challenge lasts | **Done** | Docs: 24 hours by default, `expiresAt` up to 2 weeks. Live: a challenge with `expiresAt` = now + 60 s returned 404 after expiry and could not be joined. The challenge JSON has no expiry field, so the default cannot be read back. |
| 3 | Results by game id | **Done, one gap** | Live: `mate` and `resign` give `status` plus `winner` (`white` or `black`). `draw`, and `aborted`, have no `winner`. A fresh game reads `started`. An unfinished game's move count is delayed, so ignore it. Not yet seen: `noStart` and `timeout`. |
| 4 | Options to stop dodging a game | **Done** | Live: `noAbort` is refused with "restricted to challenge administrators", so **aborts cannot be blocked**. Comma-separated rules are accepted. `noEarlyDraw` works: a draw agreed after 2 plies is ignored. **`noGiveTime` does not stop the add-time API**: it still added 15 seconds (measured), so it likely only removes the in-game button. `noRematch` and `noClaimWin` are untested. |
| 5 | Swiss inside a team, and its tiebreak | **Creation verified live; tiebreak from source** | Live: the team leader created a Swiss with `POST /api/swiss/new/{teamId}` (blitz 60+3, 3 rounds, `rated=false`, `conditions.allowList` of the signed-up names), and all three accounts joined with `POST /api/swiss/{id}/join`. At least 3 rounds, at most 12 a day. Standings: `GET /api/swiss/{id}/results` with `rank, points, tieBreak, performance, absent`. **Ranking is points, then a Sonneborn-Berger-style tiebreak, then performance** (source: `makeScore`), which matches Joel's research. Not exercised live: **the Board API refuses tournament games**, so a Swiss cannot be played by script. |
| 6 | A Swiss player who never moves | **Done live** | Nobody moved in a 3-player Swiss. Lichess ended each unplayed game by itself within about a minute (28 and 56 seconds measured): the side to move lost on time (`outoftime`) and the opponent won, with no moves played. **That player is marked `absent` and is not paired in later rounds.** A bye scored 1 point. With only one present player left the Swiss **finished early, on round 2 of 3**. |
| 7 | 5+2 is blitz | **Verified live and in source** | Estimated duration `limit + 40 x increment` = 380 s, and blitz is 180 to 479 s. Live: a 5+2 game reports `speed: blitz`, `perf: blitz`. |
| 8 | Rate limits | **Done at this scale** | Official rule: one request at a time, and on HTTP 429 wait at least a minute. Live, one request at a time: 60 restricted challenges created in a row and cancelled, 64 profile reads, and a `games-by-users` stream, with no 429. Swiss creation is capped at 12 a day. Bulk pairing needs every player's own token, so it is not an option. |

## Behaviour that changes the design

- **Lichess flags a clock only for connected players.** Live, on blitz 1+3: with both players holding the game open the
  side to move was flagged (`outoftime`, the other side wins) after about 69 seconds. With nobody connected, the same
  game was still running after 130 seconds. Players on lichess.org are connected, so this mostly matters for tests and
  for a player who vanishes: keep the referee override.
- **Lichess does not abort a game because someone never moves.** Live, with both players connected through the API,
  a game where nobody moved, and one where Black never replied, were still running after 130 seconds. This does not
  prove what happens for people in a browser, so treat it as "do not rely on Lichess to end a no-show".
- **An early resignation is an abort.** Resigning before both players have moved is recorded as `aborted` with no
  winner, exactly like pressing Abort. So `aborted` can mean "someone dodged". The app should treat it as "not played",
  issue a new link for the same game number, and flag repeated aborts to the referee. Joel needs to decide the rule:
  who is at fault, and how many times it can happen.
- **A no-show is best handled before a game exists.** If a player never opens the link, no game has started, only an
  open challenge, and the app can cancel it with its own token. Once both have joined, only a player can abort.
- **The Board API cannot play ultrabullet, or any tournament game.** Games at 15 seconds, and every Swiss game, are
  refused ("cannot be played with the Board API"). Test clocks must be blitz or slower, and Swiss games must be
  played on lichess.org.
- **In the Swiss, a missed first move costs the game and the seat.** Lichess flags the side to move within about a
  minute, marks that player `absent`, and does not pair them again unless they rejoin on lichess.org. Rules text for
  players should say so.
- **A Swiss can end early.** If fewer than two present players remain, Lichess finishes it, and `nbRounds` shrinks to
  the rounds played. Read `status`, `round` and `nbRounds` from Lichess instead of assuming 5 rounds, and take the final
  ranks only when `status` is `finished`.

## What this changes in the design

- **Colours.** Put the higher seed first in `users` for games 1, 3 and 5, and the lower seed first for games 2 and 4.
- **Reading results.** Watch `games-by-users` for finishes (one connection), then fetch each finished game by id.
  Send requests one at a time through a single queue, and back off for a full minute on a 429.
- **Login.** Logging in needs no OAuth scope: the username and rating are public. Players never hand over a token.
- **Usernames** come back in display case (`Lichess`) with a lowercase `id`. Match them case-insensitively, as the app does.
- **Swiss entry.** Use `conditions.allowList` to admit only the signed-up players.
- **Team membership** is public: `GET /api/team/{id}/users` lists members without a token. `GET /api/team/of/{username}`
  needs a `team:read` scope, so avoid it.

## Still to do

- The browser half of the restricted-link check: open the link as an unnamed account and logged out.
- Optional: a Swiss played by hand on lichess.org with a deliberate three-way tie, to see the tiebreak order live. The
  source already answers it, and the app only reads Lichess's `rank`.
