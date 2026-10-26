import { describe, expect, it } from "vitest";
import { PERMISSIONS, PRESETS, can, type AdminAccess } from "./permissions";

const joel: AdminAccess = { username: "Joel", superAdmin: true, grants: [] };
const referee: AdminAccess = { username: "Ruth", superAdmin: false, grants: PRESETS.referee };
const desk: AdminAccess = { username: "Dan", superAdmin: false, grants: PRESETS.desk };

describe("can", () => {
  it("gives the super admin everything", () => {
    for (const p of PERMISSIONS) expect(can(joel, p, false)).toBe(true);
  });

  it("follows the brief's table for the referee preset", () => {
    expect(PERMISSIONS.filter((p) => can(referee, p, false))).toEqual(["result", "forfeit", "announce"]);
  });

  it("follows the brief's table for the desk preset", () => {
    expect(PERMISSIONS.filter((p) => can(desk, p, false))).toEqual(["roster", "announce"]);
  });

  it("can be adjusted tick by tick", () => {
    const trusted = { ...referee, grants: [...referee.grants, "settings" as const] };
    expect(can(trusted, "settings", false)).toBe(true);
    expect(can(trusted, "admins", false)).toBe(false);
  });

  it("denies by default", () => {
    expect(can(null, "result", false)).toBe(false);
    expect(can(undefined, "result", false)).toBe(false);
    expect(can({ username: "Nobody", superAdmin: false, grants: [] }, "result", false)).toBe(false);
  });

  it("expires for admins when the tournament ends, but not for the super admin", () => {
    for (const p of PERMISSIONS) {
      expect(can(referee, p, true)).toBe(false);
      expect(can(desk, p, true)).toBe(false);
      expect(can(joel, p, true)).toBe(true);
    }
  });
});
