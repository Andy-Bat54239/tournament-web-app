import { sameUser } from "@/domain/registration";

export interface SessionIdentity {
  username: string;
  /** Signed in as the super admin, with a password. Otherwise it was Lichess that said who this is. */
  admin: boolean;
}

/**
 * Who a session counts as. Two rules keep the super admin's name safe:
 *
 *  - A session from the password sign-in only counts if its name is the super admin's now. If SUPER_ADMIN was changed,
 *    the old super admin's session stops working.
 *  - A session from Lichess never counts as the super admin's name, whoever owns that Lichess account. Sessions made
 *    before this rule existed are covered too.
 *
 * Returns the name to act as, or null for nobody.
 */
export function actorFor(identity: SessionIdentity | null, superAdmin: string | null): string | null {
  if (!identity) return null;
  const isSuperAdmin = superAdmin !== null && sameUser(identity.username, superAdmin);
  if (identity.admin) return isSuperAdmin ? superAdmin : null;
  return isSuperAdmin ? null : identity.username;
}
