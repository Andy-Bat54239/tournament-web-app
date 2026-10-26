import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, clientId, loginMode, redirectUri } from "./auth-config";

afterEach(() => vi.unstubAllEnvs());

describe("loginMode", () => {
  it("is the mock by default, for development", () => {
    vi.stubEnv("LICHESS_LOGIN", "");
    vi.stubEnv("LICHESS_MODE", "");
    expect(loginMode()).toBe("mock");
  });

  it("is the real login whenever the real Lichess is in use", () => {
    vi.stubEnv("LICHESS_LOGIN", "");
    vi.stubEnv("LICHESS_MODE", "live");
    expect(loginMode()).toBe("oauth");
  });

  it("can be chosen outright, either way", () => {
    vi.stubEnv("LICHESS_MODE", "live");
    vi.stubEnv("LICHESS_LOGIN", "mock");
    expect(loginMode()).toBe("mock");
    vi.stubEnv("LICHESS_MODE", "");
    vi.stubEnv("LICHESS_LOGIN", "oauth");
    expect(loginMode()).toBe("oauth");
  });

  it("ignores a value it does not know, rather than guessing", () => {
    vi.stubEnv("LICHESS_MODE", "");
    vi.stubEnv("LICHESS_LOGIN", "oauth2");
    expect(loginMode()).toBe("mock");
  });
});

describe("clientId", () => {
  it("has a default name, and can be changed", () => {
    vi.stubEnv("LICHESS_CLIENT_ID", "");
    expect(clientId()).toBe("castle-connect-ug");
    vi.stubEnv("LICHESS_CLIENT_ID", "castle-connect-staging");
    expect(clientId()).toBe("castle-connect-staging");
  });
});

describe("appOrigin", () => {
  it("uses the address the app was reached on in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "");
    expect(appOrigin("http://localhost:3000/api/auth/lichess?next=/")).toBe("http://localhost:3000");
  });

  it("prefers the configured address, without a trailing slash or path", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "https://tournament.example.org/");
    expect(appOrigin("http://localhost:3000/x")).toBe("https://tournament.example.org");
  });

  it("must be configured, and be https, in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    expect(() => appOrigin("https://anything.example/x")).toThrow(/APP_URL must be set/);
    vi.stubEnv("APP_URL", "http://tournament.example.org");
    expect(() => appOrigin("https://anything.example/x")).toThrow(/https/);
    vi.stubEnv("APP_URL", "https://tournament.example.org");
    expect(appOrigin("http://attacker.example/x")).toBe("https://tournament.example.org");
  });
});

describe("redirectUri", () => {
  it("is the callback on the app's own address", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "");
    expect(redirectUri("http://localhost:3000/anything")).toBe("http://localhost:3000/api/auth/lichess/callback");
  });
});
