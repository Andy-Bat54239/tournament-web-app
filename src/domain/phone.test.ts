import { describe, expect, it } from "vitest";
import { formatUgandaPhone, normalizeUgandaPhone } from "./phone";

describe("normalizeUgandaPhone", () => {
  it("accepts +256 with nine digits, however it is spaced", () => {
    expect(normalizeUgandaPhone("+256 772 123 456")).toBe("+256772123456");
    expect(normalizeUgandaPhone("+256-772-123-456")).toBe("+256772123456");
    expect(normalizeUgandaPhone(" +256772123456 ")).toBe("+256772123456");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "0772123456", "256772123456", "+256 77 123", "+2567721234567", "+254772123456", "+256 abc"]) {
      expect(normalizeUgandaPhone(bad)).toBeNull();
    }
  });
});

describe("formatUgandaPhone", () => {
  it("groups the digits for reading", () => {
    expect(formatUgandaPhone("+256772123456")).toBe("+256 772 123 456");
  });
});
