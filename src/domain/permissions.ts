/**
 * Organizer roles (brief, section 4). Access is deny-by-default: an admin can
 * only do what the super admin has switched on for them, per tournament, and it
 * all expires when the tournament ends.
 */

export const PERMISSIONS = [
  "result", // set or override a result
  "forfeit", // forfeit or remove a player during the event (no-shows)
  "roster", // check players in, add or remove before the start
  "announce", // post announcements and share images
  "rounds", // start rounds and build the bracket
  "settings", // change cap, timers, rules, or the tournament date and time
  "admins", // add admins, cancel the tournament
  "audit", // read the audit log
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Starting presets; each can be adjusted tick by tick. */
export const PRESETS = {
  referee: ["result", "forfeit", "announce"],
  desk: ["roster", "announce"],
} as const satisfies Record<string, readonly Permission[]>;

export type Preset = keyof typeof PRESETS;

export const PERMISSION_LABELS: Record<Permission, string> = {
  result: "Set or override results",
  forfeit: "Record no-shows and forfeits",
  roster: "Run the check-in desk",
  announce: "Post announcements",
  rounds: "Build the bracket",
  settings: "Change date, time and rules",
  admins: "Manage admins",
  audit: "Read the audit log",
};

export interface AdminAccess {
  username: string;
  superAdmin: boolean;
  grants: readonly Permission[];
}

/**
 * The super admin keeps full control, including after the tournament ends (the
 * fair-play review runs for 24 hours afterwards). Everyone else loses access
 * when it ends.
 */
export function can(
  access: AdminAccess | null | undefined,
  permission: Permission,
  tournamentEnded: boolean,
): boolean {
  if (!access) return false;
  if (access.superAdmin) return true;
  return !tournamentEnded && access.grants.includes(permission);
}

/**
 * What the super admin can tick for another admin. "admins" is left out on purpose: adding admins and ending the
 * tournament are the super admin's alone, whatever anyone else is ticked for (brief, section 4).
 */
export const GRANTABLE: readonly Permission[] = PERMISSIONS.filter((p) => p !== "admins");

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

export function isPreset(value: unknown): value is Preset {
  return typeof value === "string" && Object.hasOwn(PRESETS, value);
}

/** Puts permissions in the order of PERMISSIONS and drops repeats, so the same ticks always look the same. */
export function sortedGrants(grants: Iterable<Permission>): Permission[] {
  const given = new Set(grants);
  return PERMISSIONS.filter((p) => given.has(p));
}

/** The preset these ticks are exactly, or null when they have been adjusted. */
export function presetOf(grants: readonly Permission[]): Preset | null {
  const mine = sortedGrants(grants).join();
  for (const name of Object.keys(PRESETS) as Preset[]) {
    if (sortedGrants(PRESETS[name]).join() === mine) return name;
  }
  return null;
}

/** What changed between two sets of ticks. */
export function grantChanges(before: readonly Permission[], after: readonly Permission[]) {
  return {
    added: sortedGrants(after.filter((p) => !before.includes(p))),
    removed: sortedGrants(before.filter((p) => !after.includes(p))),
  };
}
