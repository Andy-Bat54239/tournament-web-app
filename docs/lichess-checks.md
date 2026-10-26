# Lichess checks (brief, section 8)

Status as of 26 October 2026. "Docs" means Lichess's own API spec
([lichess-org/api](https://github.com/lichess-org/api/tree/master/doc/specs), which is what lichess.org/api is built
from). "Source" means the Lichess server code ([lichess-org/lila](https://github.com/lichess-org/lila)). The brief
planned to rely on third-party library docs; these are the primary sources.

| # | Check | Status | Finding |
| - | ----- | ------ | ------- |
| 1 | Restricted link refuses a third account | **Needs accounts** | Docs: `users` is "only these users will be allowed to join", and the first username gets White. Not yet tested against a real third account. |
| 2 | How long an unjoined challenge lasts | **Docs answer it** | 24 hours by default. `expiresAt` sets it, up to 2 weeks. Live confirmation is cheap and queued. |
| 3 | Results by game id | **Partly answered** | `GET /game/export/{id}` returns the result. Statuses: `created, started, aborted, mate, resign, stalemate, timeout, draw, outoftime, cheat, noStart, unknownFinish, insufficientMaterialClaim, variantEnd`. Ongoing games are delayed by 3 moves, which does not matter for finished ones. `POST /api/stream/games-by-users` streams starts and finishes for up to 300 users. Draws, aborts and timeouts need a live run to see exactly what each returns. |
| 4 | Options to stop dodging a game | **Finding: aborts cannot be blocked** | `rules` accepts `noRematch, noGiveTime, noClaimWin, noEarlyDraw`. **`noAbort` is for Lichess admins only**, so the app must handle `aborted` and `noStart` games itself. |
| 5 | Swiss inside a team, and its tiebreak | **Source answers the tiebreak; creation needs a team** | `POST /api/swiss/new/{teamId}`, scope `tournament:write`. At least 3 rounds, at most 12 tournaments a day, `rated=false` is allowed, `conditions.allowList` restricts entry to named players. Final standings: `GET /api/swiss/{id}/results` with `rank, points, tieBreak, performance`. **Ranking is points, then a Sonneborn-Berger-style tiebreak, then performance** (source: `makeScore`), which matches Joel's research. |
| 6 | A Swiss player who never moves | **Partly answered** | Source: a player who did not move is marked `absent`, and absent players are not paired in later rounds until they rejoin. How the unplayed game is scored, and how a bye is scored, needs a live run. |
| 7 | 5+2 is blitz | **Verified** | Source: estimated duration is `limit + 40 x increment` = 300 + 80 = 380 seconds. Blitz is 180 to 479. |
| 8 | Rate limits | **Partly answered** | Official rule: one request at a time. On HTTP 429, wait at least a minute. Swiss creation: 12 a day. Bulk pairing allows 500 games per 10 minutes but needs every player's own token, so it is not an option. The per-endpoint limits for challenge creation and streams need a live run. |

## What this changes in the design

- **Colours.** Put the higher seed first in `users` for games 1, 3 and 5, and the lower seed first for games 2 and 4.
- **Aborts.** A game that is `aborted` or `noStart` has no result. The app should treat it as "not played", issue a new
  link for the same game number, and flag repeated aborts to the referee. This needs a rule from Joel: who is at fault
  if a game is aborted, and how many times can it happen.
- **Reading results.** Watch `games-by-users` for finishes (one connection), then fetch each finished game by id.
  Send requests one at a time through a single queue, and back off for a full minute on a 429.
- **Login.** Logging in needs no OAuth scope: the username and rating are public. Players never hand over a token.
- **Usernames** come back in display case (`Lichess`) with a lowercase `id`. Match them case-insensitively, as the app does.
- **Swiss entry.** Use `conditions.allowList` to admit only the signed-up players.

## Still to do

Everything marked "needs accounts", then the Swiss checks (5 and 6) once the test team exists. See
`scripts/lichess-checks/README.md`.
