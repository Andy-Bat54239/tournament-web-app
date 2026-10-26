# Lichess verification checks

Runs the checks from section 8 of the brief against the real Lichess API, using three throwaway test accounts. It
makes one request at a time, as Lichess asks, and stops at the first HTTP 429.

## What you set up

1. **Three Lichess accounts** to use only for this: A, B and C. Each needs its own email address. Games between
   them are unrated. Remove them afterwards if you like.
2. **A personal access token for each**, created while logged in as that account at
   <https://lichess.org/account/oauth/token/create> with exactly these scopes ticked:
   `challenge:read`, `challenge:write`, `board:play`, `team:write`, `tournament:write`.
3. **A test team**, created by account A on the Lichess website (Community, then Teams, then New team). Leave it open
   to join with no approval. Accounts B and C join it. Only the Swiss checks need it.

Put the tokens in `scripts/lichess-checks/.env.local`, copied from `.env.example`. That file is git-ignored.
**Do not paste tokens into chat.** The scripts read them from that file and never print them.

## Running

```bash
node scripts/lichess-checks/run.mjs smoke            # no tokens needed
node scripts/lichess-checks/run.mjs preflight ccug-test-team   # tokens valid, scopes right, team members? (pass your team id)
node scripts/lichess-checks/run.mjs restricted-link  # check 1, API half
node scripts/lichess-checks/run.mjs manual-link create   # check 1, browser half (needs a person)
node scripts/lichess-checks/run.mjs manual-link verify
node scripts/lichess-checks/run.mjs expiry           # check 2 (takes about 90 seconds)
node scripts/lichess-checks/run.mjs options          # check 4
node scripts/lichess-checks/run.mjs results          # checks 3 and 7 (takes about a minute)
node scripts/lichess-checks/run.mjs timeouts         # clock flags and no-shows (takes about 2.5 minutes)
node scripts/lichess-checks/run.mjs rate-limits      # check 8
```

Raw responses are saved to `scripts/lichess-checks/results/` (git-ignored). The Swiss checks (5 and 6) come after
these, once the test team exists.
