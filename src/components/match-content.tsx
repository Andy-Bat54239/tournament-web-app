import { connection } from "next/server";
import { claimWin, getGameLink, markReady, reportProblem, simulateGame } from "@/app/actions";
import { getStore } from "@/server/instance";
import { getMockLichess } from "@/server/lichess";
import { matchScreen, type PlayView } from "@/server/match-screen";
import { getSessionUsername } from "@/server/session";
import { ActionForm } from "./action-form";
import { AutoSync } from "./auto-sync";
import { Countdown } from "./countdown";
import { LoginCard } from "./login-card";
import { MatchCard } from "./match-card";
import { SubmitButton } from "./submit-button";

function ReportProblem() {
  return (
    <details className="card">
      <summary>Report a problem</summary>
      <ActionForm action={reportProblem}>
        <label htmlFor="problem">What went wrong?</label>
        <textarea id="problem" name="text" rows={3} maxLength={500} required />
        <SubmitButton className="wide">Send to the referees</SubmitButton>
      </ActionForm>
      <p className="note">Report within 5 minutes of a game ending. A referee decides, and their decision is final.</p>
    </details>
  );
}

/** Stands in for playing on Lichess, so every state of the screen can be reached by hand. */
function Simulator({ hasLink }: { hasLink: boolean }) {
  return (
    <div className="card dev">
      <h3>Development only: act as both players</h3>
      {hasLink ? (
        <ActionForm action={simulateGame}>
          <div className="btns">
            <SubmitButton name="event" value="join">
              Both join
            </SubmitButton>
            <SubmitButton name="event" value="white">
              White wins
            </SubmitButton>
            <SubmitButton name="event" value="black">
              Black wins
            </SubmitButton>
            <SubmitButton name="event" value="draw">
              Draw
            </SubmitButton>
            <SubmitButton name="event" value="abort" className="quiet">
              Abort
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <p className="note">Tap I’m ready first, to get a game link.</p>
      )}
      <p className="note">This stands in for playing on Lichess with the mock. It does not exist in the real app.</p>
    </div>
  );
}

function WaitLine({ view }: { view: PlayView }) {
  if (view.claim) return null;
  if (view.joined) return <p className="note">You are both on Lichess. The result is read automatically.</p>;
  if (view.window.over) return <p className="err">The waiting time is over.</p>;
  return (
    <p>
      Be there within <Countdown closesAt={view.window.closesAt} initialSeconds={view.window.secondsLeft} />.
    </p>
  );
}

function PlayScreen({
  view,
  names,
  simulator,
}: {
  view: PlayView;
  names: Parameters<typeof MatchCard>[0]["names"];
  simulator: boolean;
}) {
  const { opponent, game, ready, link, claim, claimBlocked } = view;
  return (
    <>
      <MatchCard match={view.match} names={names} games={view.games} isFinal={view.isFinal} />
      <div className="card">
        <p className="strong">
          Your opponent: {opponent.name} (seed {opponent.seed})
        </p>
        <p>
          Game {game.number}: {game.youAreWhite ? "you play" : `${game.whiteName} plays`} White
          {game.youAreWhite ? "" : ", so you play Black"}.
        </p>
        {view.aborts > 0 && (
          <p className="note">
            Lichess aborted {view.aborts === 1 ? "a game" : `${view.aborts} games`} of this match. Those do not count, so game{" "}
            {game.number} is played again on a new link.
          </p>
        )}
        {view.refereeNote && <p className="note">A referee is checking this game. {view.refereeNote}</p>}
        <WaitLine view={view} />

        {!ready.me ? (
          <ActionForm action={markReady}>
            <SubmitButton className="wide">I’m ready</SubmitButton>
          </ActionForm>
        ) : link ? (
          <a className="button gold wide" href={link} target="_blank" rel="noopener noreferrer">
            Play on Lichess
          </a>
        ) : (
          <ActionForm action={getGameLink}>
            <SubmitButton className="wide gold">Get the game link</SubmitButton>
          </ActionForm>
        )}
        <p className="note">
          {ready.me
            ? `The link opens only for you and ${opponent.name}. The result is read automatically.`
            : "Tap I’m ready so the app knows you were waiting."}{" "}
          {ready.opponent ? `${opponent.name} is ready.` : `${opponent.name} has not tapped ready yet.`}
        </p>

        {claim?.by === "me" && <p className="ok">Your claim is with a referee. They will decide shortly.</p>}
        {claim?.by === "opponent" && (
          <p className="err">
            {opponent.name} says you did not appear, so a referee will decide. If you are here, tap I’m ready and tell a
            referee.
          </p>
        )}
        {!claim && (
          <ActionForm action={claimWin}>
            <SubmitButton className="wide quiet" disabled={claimBlocked !== null}>
              Opponent absent? Claim win
            </SubmitButton>
            {claimBlocked && <p className="note">{claimBlocked}</p>}
          </ActionForm>
        )}
      </div>
      <ReportProblem />
      {simulator && <Simulator hasLink={link !== null} />}
      <AutoSync everyMs={8_000} />
    </>
  );
}

/** The player's own match, whatever stage they are at. Reads live state, so use inside <Suspense>. */
export async function MatchContent() {
  await connection();
  const now = new Date();
  const username = await getSessionUsername();
  if (!username) {
    return (
      <>
        <p className="note">Log in with Lichess to see your match.</p>
        <LoginCard />
      </>
    );
  }

  const store = getStore();
  const screen = matchScreen(store, username, now);

  switch (screen.kind) {
    case "no_bracket":
      return (
        <>
          <div className="card">
            <p className="strong">The knockout has not started.</p>
            <p className="note">Your match appears here once the bracket is built.</p>
          </div>
          <AutoSync everyMs={15_000} />
        </>
      );
    case "not_qualified":
      return (
        <div className="card">
          <p className="strong">You are not in the knockout.</p>
          <p className="note">You can follow it on the Bracket page.</p>
        </div>
      );
    case "waiting":
      return (
        <>
          <div className="card">
            <p className="strong">You’ve advanced to the {screen.title}.</p>
            <p className="note">Waiting for the earlier match to finish, then your opponent appears here.</p>
          </div>
          <AutoSync everyMs={10_000} />
        </>
      );
    case "out":
      return (
        <>
          <div className="card">
            <p className="strong">You’re out in the {screen.title}.</p>
            <p className="note">
              {screen.winnerName
                ? `${screen.winnerName} advanced${screen.how ? ` ${screen.how}` : ""}. Thanks for playing.`
                : "Neither player appeared, so both of you are out. Thanks for playing."}{" "}
              The live bracket shows what’s next.
            </p>
          </div>
          <ReportProblem />
        </>
      );
    case "champion":
      return <div className="champ">You won the tournament (provisional).</div>;
    case "play":
      return (
        <PlayScreen
          view={screen}
          names={store.tournament.qualifiers ?? []}
          simulator={getMockLichess() !== null && process.env.NODE_ENV !== "production"}
        />
      );
  }
}
