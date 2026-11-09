import { describe, expect, it } from "vitest";
import { actorFor } from "./identity";

const lichess = (username: string) => ({ username, admin: false });
const admin = (username: string) => ({ username, admin: true });

describe("who a session counts as", () => {
  it("is nobody without a session", () => {
    expect(actorFor(null, "Joel")).toBeNull();
    expect(actorFor(null, null)).toBeNull();
  });

  it("is a Lichess player as themselves", () => {
    expect(actorFor(lichess("Mercy_K"), "Joel")).toBe("Mercy_K");
    expect(actorFor(lichess("Mercy_K"), null)).toBe("Mercy_K");
  });

  it("is the super admin only through the password sign-in, under the name the host has set", () => {
    expect(actorFor(admin("joel"), "Joel")).toBe("Joel");
  });

  it("is nobody when a Lichess session has the super admin's name, however it is written", () => {
    expect(actorFor(lichess("Joel"), "Joel")).toBeNull();
    expect(actorFor(lichess("JOEL"), "Joel")).toBeNull();
    expect(actorFor(lichess("joel"), "Joel")).toBeNull();
  });

  it("is nobody when a password session names someone who is not the super admin, or there is no super admin", () => {
    expect(actorFor(admin("Mercy_K"), "Joel")).toBeNull();
    expect(actorFor(admin("Joel"), null)).toBeNull();
  });

  it("stops the old super admin's session when SUPER_ADMIN is changed", () => {
    expect(actorFor(admin("Joel"), "Ruth")).toBeNull();
  });
});
