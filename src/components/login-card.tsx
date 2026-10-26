import { mockLogin } from "@/app/actions";
import { loginMode } from "@/server/auth-config";
import { ActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";

/**
 * "Log in with Lichess". With the real login this is one button that takes the person to Lichess and back to the
 * page they were on. With the development stand-in it is a form where any username can be typed.
 */
export function LoginCard({ next = "/" }: { next?: string }) {
  if (loginMode() === "oauth") {
    return (
      <div className="card">
        <a className="button gold wide" href={`/api/auth/lichess?next=${encodeURIComponent(next)}`}>
          Log in with Lichess
        </a>
        <p className="note">
          Your username comes from Lichess. The app never sees your password, and asks Lichess for no permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <ActionForm action={mockLogin}>
        <label htmlFor="username">Lichess username</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" required />
        <SubmitButton className="wide">Log in with Lichess</SubmitButton>
      </ActionForm>
      <p className="note">Your username comes from Lichess. The app never sees your password.</p>
      {process.env.NODE_ENV !== "production" && (
        <p className="note dev">
          Development mode: this is a stand-in for the real login, so type any username. Joel is the super admin,
          Ruth_Ref a referee and Dan_Desk the check-in desk.
        </p>
      )}
    </div>
  );
}
