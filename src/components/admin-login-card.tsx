import { adminLogin } from "@/app/actions";
import { DEV_ADMIN_PASSWORD, adminPassword, superAdminName } from "@/server/auth-config";
import { ActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";

/**
 * The super admin's sign-in: a username and a password, not Lichess. Everyone else, the referees and the check-in desk
 * included, logs in with Lichess. The form is the same for everybody who opens the Organizer page, and says nothing
 * about which name is the super admin's.
 */
export function AdminLoginCard() {
  const development = process.env.NODE_ENV !== "production" && adminPassword()?.kind === "development";
  return (
    <div className="card">
      <h3>Super admin</h3>
      <ActionForm action={adminLogin}>
        <label htmlFor="admin-username">Username</label>
        <input id="admin-username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="wide">Sign in</SubmitButton>
      </ActionForm>
      {development && (
        <p className="note dev">
          Development mode: the username is {superAdminName()} and the password is {DEV_ADMIN_PASSWORD}. On a real host
          the password comes from SUPER_ADMIN_PASSWORD_HASH.
        </p>
      )}
    </div>
  );
}
