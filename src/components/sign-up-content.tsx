import { connection } from "next/server";
import { checkIn, joinTeam, logout, signUp, withdraw } from "@/app/actions";
import {
  registeredCount,
  spotNumber,
  waitlistPosition,
  type Registration,
} from "@/domain/registration";
import { canWithdraw, eastTime, phaseAt, type Phase, type Schedule } from "@/domain/schedule";
import { getStore } from "@/server/instance";
import { getLichess } from "@/server/lichess";
import { getSessionUsername } from "@/server/session";
import { ActionForm } from "./action-form";
import { LoginCard } from "./login-card";
import { SubmitButton } from "./submit-button";

const ratingText = (rating: number | null) => (rating === null ? "new" : String(rating));

function SpotsCard({
  taken,
  cap,
  waitlist,
  phase,
  schedule,
}: {
  taken: number;
  cap: number;
  waitlist: number;
  phase: Phase;
  schedule: Schedule;
}) {
  return (
    <div className="card">
      <p className="strong">
        {taken} of {cap} spots taken
      </p>
      <div className="bar" role="presentation">
        <div style={{ width: `${Math.round((taken / cap) * 100)}%` }} />
      </div>
      {waitlist > 0 && <p className="note">{waitlist} on the waitlist.</p>}
      <p className="note">
        {phase === "signup_open"
          ? `Sign-ups close the night before the start. Check-in opens at ${eastTime(schedule.checkInOpensAt)}.`
          : "Sign-ups are closed."}
      </p>
    </div>
  );
}

function JoinCard({ username, rating }: { username: string; rating: number | null }) {
  return (
    <div className="card">
      <p className="strong">{username}</p>
      <p className="note">Lichess blitz rating {ratingText(rating)}</p>
      <ActionForm action={signUp}>
        <label htmlFor="whatsapp">WhatsApp number</label>
        <input
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+256 7XX XXX XXX"
          aria-describedby="whatsapp-consent"
          required
        />
        <p id="whatsapp-consent" className="note">
          Only organizers see this number, and only to reach you on the day. Players never do.
        </p>
        <label className="ck">
          <input type="checkbox" name="rules" />
          <span>I accept the rules and the fair-play policy.</span>
        </label>
        <SubmitButton className="wide">Join the tournament</SubmitButton>
      </ActionForm>
    </div>
  );
}

function ConfirmedCard({
  me,
  registrations,
  phase,
  schedule,
  withdrawable,
}: {
  me: Registration;
  registrations: readonly Registration[];
  phase: Phase;
  schedule: Schedule;
  withdrawable: boolean;
}) {
  const spot = spotNumber(registrations, me.username);
  const place = waitlistPosition(registrations, me.username);
  const checkInOpen = phase === "check_in_open";
  const checkInLabel = me.checkedIn ? "Checked in" : "Check in";

  return (
    <div className="card">
      <p className="strong">
        {spot ? `You’re in. Spot ${spot}.` : `You’re on the waitlist. Place ${place}.`}
      </p>
      <p className="note">
        Rating {ratingText(me.rating)} {phase === "signup_open" ? "locks when sign-ups close." : "is locked."}
      </p>
      <div className="btns">
        <ActionForm action={joinTeam} className="grow">
          <SubmitButton className="wide" disabled={me.teamJoined}>
            {me.teamJoined ? "Joined the Lichess team" : "Join the Lichess team"}
          </SubmitButton>
        </ActionForm>
        <ActionForm action={checkIn} className="grow">
          <SubmitButton className="wide gold" disabled={me.checkedIn || !checkInOpen}>
            {checkInLabel}
          </SubmitButton>
        </ActionForm>
      </div>
      <p className="note">
        {me.checkedIn
          ? "You’re checked in."
          : checkInOpen
            ? "Tap Check in before the window closes."
            : phase === "signup_open" || phase === "signup_closed"
              ? `Check-in opens at ${eastTime(schedule.checkInOpensAt)}.`
              : "Check-in is closed."}{" "}
        Players who don’t check in are removed and the waitlist fills their place.
      </p>
      {withdrawable && (
        <ActionForm action={withdraw}>
          <SubmitButton className="quiet">Withdraw from the tournament</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

/** Reads the session and live tournament state, so render it inside <Suspense>. */
export async function SignUpContent() {
  await connection();
  const now = new Date();
  const store = getStore();
  const schedule = store.schedule();
  const phase = phaseAt(schedule, now);
  const username = await getSessionUsername();
  const me = username ? store.registration(username) : undefined;
  const signedUp = me?.status === "registered" || me?.status === "waitlisted";
  const profile = username && !signedUp ? await getLichess().getProfile(username) : null;
  const regs = store.registrations;

  return (
    <>
      <SpotsCard
        taken={registeredCount(regs)}
        cap={store.tournament.cap}
        waitlist={regs.filter((r) => r.status === "waitlisted").length}
        phase={phase}
        schedule={schedule}
      />
      {!username ? (
        <LoginCard />
      ) : me && signedUp ? (
        <ConfirmedCard
          me={me}
          registrations={regs}
          phase={phase}
          schedule={schedule}
          withdrawable={canWithdraw(schedule, now, {
            bracketBuilt: store.tournament.bracket !== null,
            scheduleChanged: store.tournament.scheduleChange !== null,
          })}
        />
      ) : phase !== "signup_open" ? (
        <div className="card">
          <p className="strong">Sign-ups are closed.</p>
          <p className="note">Late arrivals cannot join once the tournament is under way.</p>
        </div>
      ) : profile ? (
        <JoinCard username={profile.username} rating={profile.blitzRating} />
      ) : (
        <div className="card">
          <p className="err">We could not find your Lichess account. Log out and try again.</p>
        </div>
      )}
      {username && (
        <form action={logout} className="who">
          <span>Logged in as {username}.</span>
          <button type="submit" className="quiet">
            Log out
          </button>
        </form>
      )}
    </>
  );
}
