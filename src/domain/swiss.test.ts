import { describe, expect, it } from "vitest";
import { parseSwissId } from "./swiss";

describe("parseSwissId", () => {
  it("takes the bare id", () => {
    expect(parseSwissId("FgUapYId")).toBe("FgUapYId");
    expect(parseSwissId("  FgUapYId \n")).toBe("FgUapYId");
  });

  it("takes the page address, with or without the scheme, www, a slash, a query or a fragment", () => {
    for (const input of [
      "https://lichess.org/swiss/FgUapYId",
      "http://lichess.org/swiss/FgUapYId",
      "lichess.org/swiss/FgUapYId",
      "https://www.lichess.org/swiss/FgUapYId/",
      "https://lichess.org/swiss/FgUapYId?player=andybat7#games",
    ]) {
      expect(parseSwissId(input), input).toBe("FgUapYId");
    }
  });

  it("refuses anything else", () => {
    for (const input of [
      "",
      "   ",
      "FgUapYI",
      "FgUapYIdd",
      "Fg Uap Id",
      "https://lichess.org/tournament/FgUapYId",
      "https://lichess.org/swiss/",
      "https://lichess.org/swiss/short",
      "https://evil.example/swiss/FgUapYId",
      "https://lichess.org.evil.example/swiss/FgUapYId",
      "https://lichess.org@evil.example/swiss/FgUapYId",
      "javascript:alert(1)",
    ]) {
      expect(parseSwissId(input), input).toBeNull();
    }
  });
});
