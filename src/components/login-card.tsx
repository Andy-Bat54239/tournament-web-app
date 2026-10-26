import { mockLogin } from "@/app/actions";
import { ActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";

/** Stands in for the "Log in with Lichess" OAuth button until the real flow is built. */
export function LoginCard() {
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
          Development mode: no real Lichess login yet, so type any username. Joel is the super admin, Ruth_Ref a
          referee and Dan_Desk the check-in desk.
        </p>
      )}
    </div>
  );
}
