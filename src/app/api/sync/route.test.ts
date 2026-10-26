import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncResults = vi.fn();
vi.mock("@/server/instance", () => ({ syncResults: () => syncResults() }));

import { GET, POST } from "./route";

const call = (method: typeof GET, authorization?: string) =>
  method(new NextRequest("http://localhost:3000/api/sync", authorization ? { headers: { authorization } } : undefined));

beforeEach(() => {
  syncResults.mockReset();
  syncResults.mockResolvedValue({ checked: 2, changed: 1, stopped: null, failed: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe("the address that reads results", () => {
  it("is off, for everyone, until CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call(GET, "Bearer ");
    expect(response.status).toBe(503);
    expect(syncResults).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret, and reads nothing", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    for (const authorization of [undefined, "Bearer wrong", "s3cret"]) {
      const response = await call(GET, authorization);
      expect(response.status, String(authorization)).toBe(401);
    }
    expect(syncResults).not.toHaveBeenCalled();
  });

  it("reads the games and reports what it found, for GET (cron services) and POST", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    for (const method of [GET, POST]) {
      const response = await call(method, "Bearer s3cret");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ checked: 2, changed: 1, stopped: null, failed: 0 });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(syncResults).toHaveBeenCalledTimes(2);
  });

  it("says so when reading fails, without leaking why", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    syncResults.mockRejectedValue(new Error("password=hunter2 refused"));
    const response = await call(GET, "Bearer s3cret");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});
