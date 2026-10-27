# Dress rehearsal

A full run of the tournament on a real host, with real Lichess accounts and a real Swiss, a few days before the event.
Nothing here is new code. It is the only way to find out what the stand-ins hid.

**What it proves** (none of this has been tried outside tests and a local machine):

- the app runs on a real https address, with a real Postgres, and Log in with Lichess comes back to it
- the real Lichess creates game links, and results are read back, including with nobody looking at the page
- a real Swiss, read while it is running and when it ends, and a bracket built from it
- the no-show flow, a referee override, and the projector view on a real projector

**What it cannot prove:** the cut-off line and the bubble with a full field (they need 17 or more real accounts; they
are covered by tests), and how the host copes with 64 people at once.

**Time and people:** about two hours. You, at a laptop, plus the three throwaway Lichess accounts (`andybat7`,
`andybat22`, `patience-mushishi`) each in its own browser window or profile. A projector or television for the last
part. Do it at least three days before the event so there is time to fix what turns up.

**Secrets:** never paste a token, a password or a connection string into a chat or a document. Put them straight into
the host's settings. Where this page says "copy", it means to the clipboard, then into the settings page.

---

## Part A. Put the app on a real host

The suggested host is Vercel with a Neon database. Vercel's free plan (Hobby) is for non-commercial use, which a
community event fits; check its current terms. A host that stays running (a VPS) also works: set `BACKGROUND_SYNC=true`
instead of the pinger in step A5.

### A1. The accounts you need

| Account | What for | Cost |
| ------- | -------- | ---- |
| GitHub (you have it) | Vercel reads the code from `Andy-Bat54239/tournament-web-app` | free |
| Vercel | Runs the app | free (Hobby) |
| Neon (you have it) | The database | free |
| cron-job.org | Calls the app every minute to read results nobody is looking at | free |
| Lichess `andybat7` | Team leader of `ccug-test-team`; creates the Swiss and the game links | free |

### A2. Start from an empty database

The Neon database still holds the demo tournament from earlier tests, with a bracket already built. Clear it first:
Neon console, your project, **SQL Editor**, run exactly this, and nothing else:

```sql
delete from tournament_state;
```

### A3. Make two secrets

In a terminal, one at a time. Each command puts a long random string on the clipboard and shows nothing:

```bash
openssl rand -base64 48 | pbcopy
```

Use it at once (A4), then run the command again for the second one. The first is `SESSION_SECRET`, the second is
`CRON_SECRET`. Do not copy anything else in between. Do `CRON_SECRET` last, and see A5 before you copy anything new.

### A4. Create the Vercel project and its settings

1. vercel.com, sign up **with GitHub**, then **Add New, Project**, and import `tournament-web-app`.
2. Leave the framework (Next.js), the root directory and the build settings as they are.
3. Before pressing Deploy, open **Environment Variables** and add these, all for Production:

| Name | Value for the rehearsal | Notes |
| ---- | ----------------------- | ----- |
| `DATABASE_URL` | the Neon connection string | Neon, **Connection string, pooled**. Change `sslmode=require` to `sslmode=verify-full`. It is also in your local `web/.env.local`: open that file and copy the value. |
| `SESSION_SECRET` | the first secret from A3 | |
| `LICHESS_MODE` | `live` | The real Lichess. The login becomes the real one by itself. |
| `LICHESS_SERVICE_TOKEN` | a new token, see below | |
| `SUPER_ADMIN` | **your own** Lichess username | Joel's at the event. It must match the name you log in with. |
| `SEED_DEMO` | `true` | **Rehearsal only.** 41 invented players pad the field to 17 or more, so the Swiss format runs. |
| `CRON_SECRET` | the second secret from A3 | |

Leave everything else unset. In particular **`ALLOW_MOCK_LOGIN` must not exist**, and `BACKGROUND_SYNC` stays off on
Vercel. `APP_URL` comes after the first deploy (A5). `TOURNAMENT_START` is not needed: the default, Sunday 1 November
14:00, has sign-ups open until the night before.

**The service token.** Log in to Lichess as `andybat7`, open
https://lichess.org/account/oauth/token/create , tick **only** `challenge:read` and `challenge:write`, give it a name
such as `rehearsal`, create it, and copy it straight into `LICHESS_SERVICE_TOKEN`. The tokens from the earlier checks
carry more permissions than the app needs, so do not reuse them.

**Demo admins.** `SEED_DEMO=true` also creates two admin names, `Ruth_Ref` and `Dan_Desk`. If a stranger owns those
Lichess names they could log in as a referee. The address is not public, but remove both in the **Admins** card the
first time you open the Organizer page.

4. Press **Deploy**. When it finishes, Vercel shows the address, for example `https://tournament-web-app.vercel.app`.

### A5. Tell the app its own address, and start the results reader

1. Settings, Environment Variables, add `APP_URL` = that address: `https://`, no slash at the end, no path. It must be
   the same address your browser shows. Then **Deployments, the three dots, Redeploy**. Settings only apply to a new
   deploy.
2. Settings, Functions, set the region to **Frankfurt (fra1)**, which is next to the database, and redeploy again if it
   asks.
3. cron-job.org, create a job:
   - Address: `https://<your address>/api/sync`
   - Every **1 minute**
   - Under **Advanced, Headers**, add `Authorization` with the value `Bearer ` (the word, then a space) followed by the
     `CRON_SECRET`. Paste it straight from the clipboard; if you have copied something since, make a new secret, put it
     in Vercel as `CRON_SECRET`, redeploy, and paste that.
   - Save, then press **Test run**. Expected answer: `{"checked":0,"changed":0,"stopped":null,"failed":0}` with status 200.

### A6. Smoke test (five minutes, before anyone else is involved)

| Do this | Expect |
| ------- | ------ |
| Open the address on your phone | The sign-up page, "Tournament starts Sunday 1 November, 14:00" |
| Open `/bracket` | "The bracket is not built yet." and, within a few seconds, no error |
| Log in as yourself (the button on the sign-up page) | Lichess asks to log in and shows **no permissions list**, then you come back logged in as your username |
| Open `/organizer` | The full organizer screen. If it says you cannot see it, `SUPER_ADMIN` does not match your username |
| Open `https://<address>/api/sync` in the browser | `{"error":"Not allowed."}` with status 401. That is correct: strangers are refused |
| Organizer, Admins | Remove `Ruth_Ref` and `Dan_Desk` |

If something is off, see the table at the end before going on.

---

## Part B. The rehearsal

**Cast.** Organizer = you, as the super admin. Players = `andybat7`, `andybat22` and `patience-mushishi`, each logged in
to Lichess in its own browser profile or private window. The account `patience-mushishi` looked like a real person's
name when the checks were set up, so confirm it is a throwaway before using it.

For every step: **Do**, **Expect**, and write down anything else you see. A table to fill in is at the end.

### B1. Sign-up (sign-ups are open until the night before the start)

1. In each of the three player windows: open the address, **Log in with Lichess**, fill in a WhatsApp number such as
   `+256 700 000001`, tick the rules box, **Join the tournament**.
2. Expect: each sees a confirmation with their blitz rating (or "new" if provisional). Use **Join the Lichess team**
   too. Note that the app does not check this against Lichess.
3. As organizer: Organizer, **Check-in desk**, the roster should list the three real names among the 41 invented ones,
   with numbers visible to you only. A player must not see anyone's number.

### B2. Move the start and check in

Check-in only opens an hour before the start, and the start is days away, so bring it forward.

1. Organizer, **Tournament schedule**: set today's date and a start time **40 minutes from now** (East Africa Time),
   reason "rehearsal", **Save date and time**.
2. Expect: the page says "Schedule changed", the sign-up page of each player shows check-in open.
3. Each of the three: **Check in**. Expect "You're checked in."
4. Organizer: **Remove no-shows and promote the waitlist**. The five invented players who did not check in go.

### B3. The Swiss, on Lichess

1. Logged in to Lichess as `andybat7`, open the team page `lichess.org/team/ccug-test-team`, and create a **Swiss**
   tournament: unrated, 3 rounds, a blitz clock such as 3+2, starting in a few minutes. (The brief's real clock is 5+2.)
2. The three accounts join it on lichess.org.
3. Organizer, **Bracket**: paste the Swiss address, **Use this Swiss**. Expect its name and "Not started yet", then "Round 1 of 3" once it begins.
4. Open `/bracket` on a laptop: **Swiss standings** with only the three real players, and the sentence "Nobody is cut
   so far: 3 players for 32 places." (The 41 invented players are not in the Lichess Swiss, so they are left out.)
5. Play the rounds. Swiss games are played on lichess.org, not in the app. Play a few moves each, then resign. If you
   would rather not play at all, wait: Lichess ends unplayed games by itself in about a minute, but it then marks the
   players absent and may finish the Swiss early.
6. Watch `/bracket` through a round. Expect it to change within about 30 seconds of Lichess changing (the page
   refreshes every 30 seconds, and the app reads Lichess at most every 20). **This is the first read of a running
   Swiss from the real Lichess: note anything odd in the standings, the round count, or the progress line.**
7. When Lichess says the Swiss is finished, the progress line reads "Finished after 3 rounds" and the sentence under the
   table becomes "Everyone plays on: only 3 players for 32 places." Take the final ranks from Lichess's own page and
   compare.

### B4. Build the bracket

1. Organizer, **Bracket**: **Qualifiers**: type `3`. Leave **Hold the knockout** unticked this time.
   **Build the bracket from the Swiss standings.**
2. Expect: a bracket of 3 (the top seed has a bye). Ranks match the final Lichess standings exactly.
3. `/bracket` now shows the bracket and, under it, the Swiss as it ended.

### B5. A match, with the real Lichess

1. The two players of the first match open **My match**. Each taps **I'm ready**.
2. Expect: one game link each, only for the two players. Open it as the third account: Lichess must refuse it ("The
   challenge is not for you to accept" or similar). White is the higher seed in game 1.
3. Play the game on lichess.org (a few moves each, then resign, or play it out).
4. **Do not open My match or any page.** Wait one to two minutes, with only the pinger running. Then open `/bracket`.
   Expect the game result to be there. **This proves the background reader.** If it does not appear within three
   minutes, see the table.
5. Play game 2, and game 3 if it is 1-1. Expect the colours to alternate and the match to end when a player has 2.

### B6. The no-show flow

In the next match: one player taps **I'm ready**, the other does nothing.

1. Expect a 3-minute wait on the ready player's screen, then **Opponent absent? Claim win** becomes tappable.
2. Tap it. The organizer's **Matches that need a referee** shows the claim. Confirm it.
3. Expect: the claimant advances, the other player sees why, and the audit log records who did what.

### B7. Referee override

Organizer, **Set a result by hand**: pick a match that is still open, set a result with a reason. Expect "set by
organizer" on the public page, not the reason, and the full entry in the **Audit log**. Then undo it.

### B8. The projector

Connect the laptop to the real projector or television, open `/bracket`.

1. Expect the wide layout: the rounds across, the Swiss beside or under them.
2. Press **Full screen**. Expect the header and tabs to go. **Esc** leaves it. (This has only been tried in a pane that
   does not support full screen, so this is its first real test.)
3. Press **Larger** and **Smaller** until it reads from the back of the room. Note the percentage that worked for the
   screen and the room. Reload: the size should stick.
4. Leave it alone for two minutes while a game finishes. It should update itself.

### B9. Close down

Organizer, **End the tournament** (admins lose access). Check that the page still shows the champion or final state to
the public. Then do **Before the real event** below.

---

## Results sheet

Copy this into a note and fill it in as you go.

| Step | Worked? | What you saw |
| ---- | ------- | ------------ |
| A6 smoke test | | |
| B1 sign-up | | |
| B2 move start, check-in | | |
| B3 running Swiss read | | |
| B4 bracket from the Swiss | | |
| B5 link refused for a third account | | |
| B5 background result, nobody looking | | |
| B6 no-show claim | | |
| B7 override and audit log | | |
| B8 full screen, text size | | |

## If something goes wrong

| What you see | Most likely cause |
| ------------ | ----------------- |
| A white page or "Application error" on every page | A setting is missing or wrong. In Vercel: Deployments, the latest one, **Logs**. The message names it: `SESSION_SECRET must be set`, `APP_URL must be set`, `Lichess is not connected` |
| "APP_URL must start with https://" | `APP_URL` was typed without `https://` |
| Pages stay on "Loading…", or the log says "Connection terminated due to connection timeout" | `DATABASE_URL` is wrong, or still has `sslmode=require` with a typo. Neon also sleeps after idle time, so the first page after a quiet spell is slow |
| The login goes to Lichess but comes back with an error | `APP_URL` is not exactly the address in the browser (www, http, a trailing path, or a different Vercel address) |
| Logged in, but no Organizer | `SUPER_ADMIN` is not your Lichess username, or it was changed and the app was not redeployed |
| The login box asks you to type a username | `LICHESS_MODE` is not `live` in Production, or the app was not redeployed |
| `/api/sync` says 503 | `CRON_SECRET` is not set, or the app was not redeployed after setting it |
| `/api/sync` says 401 in the pinger | The header is wrong: it must be `Authorization: Bearer <the secret>` with one space |
| "Lichess is busy. Try again in a minute." | Lichess answered HTTP 429. The app leaves it alone for a minute by itself |
| A game link does not work or is refused for the right player | The service token is missing `challenge:write`, or belongs to a different account than you expect |
| The Swiss standings say Lichess has no such Swiss | The address was pasted from a different tournament type (it must be `lichess.org/swiss/XXXXXXXX`) |
| Changed a setting and nothing changed | Vercel applies settings to the **next** deploy: redeploy |

## Before the real event

1. **Clear the rehearsal.** Neon SQL Editor: `delete from tournament_state;`.
2. **Change the settings** in Vercel and redeploy: `SEED_DEMO` removed (or `false`), `SUPER_ADMIN` = Joel's real Lichess
   username, `LICHESS_SERVICE_TOKEN` = a token from the account Castle Connect wants the game links to come from
   (scopes `challenge:read` and `challenge:write` only), and `TOURNAMENT_START` and `TOURNAMENT_CAP` as decided.
   Make a new `SESSION_SECRET` if the old one was ever shown to anyone.
3. **Revoke the throwaway tokens** at https://lichess.org/account/oauth/token, for all three accounts, and the
   `rehearsal` one if the real token replaces it.
4. **Open the address once as Joel** and check the Organizer page is there. The first load on the empty database
   creates the tournament from the settings.
5. Look at the pinger: **Test run** again, and check the job is still enabled.
