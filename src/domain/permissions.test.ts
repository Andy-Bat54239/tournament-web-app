import { describe, expect, it } from "vitest";
import { GRANTABLE, PERMISSIONS, PRESETS, can, grantChanges, isPermission, isPreset, presetOf, sortedGrants, type AdminAccess } from "./permissions";

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

describe("ticking permissions", () => {
  it("leaves out managing admins, which only the super admin does", () => {
    expect(GRANTABLE).not.toContain("admins");
    expect(GRANTABLE).toHaveLength(PERMISSIONS.length - 1);
  });

  it("knows a permission or a preset by its exact name, and nothing inherited", () => {
    expect(isPermission("result")).toBe(true);
    for (const bad of ["Result", "toString", "__proto__", "", 3, null, undefined]) expect(isPermission(bad), String(bad)).toBe(false);
    expect(isPreset("referee")).toBe(true);
    for (const bad of ["Referee", "toString", "constructor", "", 3, null]) expect(isPreset(bad), String(bad)).toBe(false);
  });

  it("puts ticks in a fixed order and drops repeats", () => {
    expect(sortedGrants(["announce", "result", "announce", "forfeit"])).toEqual(["result", "forfeit", "announce"]);
  });

  it("recognises a preset however its ticks are ordered, and calls anything else custom", () => {
    expect(presetOf(["announce", "forfeit", "result"])).toBe("referee");
    expect(presetOf([...PRESETS.desk])).toBe("desk");
    expect(presetOf(["result"])).toBeNull();
    expect(presetOf([...PRESETS.referee, "settings"])).toBeNull();
    expect(presetOf([])).toBeNull();
  });

  it("says what was added and what was taken away", () => {
    expect(grantChanges(["result", "forfeit"], ["forfeit", "roster", "announce"])).toEqual({
      added: ["roster", "announce"],
      removed: ["result"],
    });
    expect(grantChanges(["result"], ["result"])).toEqual({ added: [], removed: [] });
  });
});

