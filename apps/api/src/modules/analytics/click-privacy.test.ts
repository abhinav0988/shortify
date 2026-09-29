import { hashClientIp } from "./click-privacy.js";

describe("hashClientIp", () => {
  const salt = "test-only-analytics-salt";

  it("is a deterministic hash and does not store the raw address", () => {
    const hashed = hashClientIp("203.0.113.10", salt);

    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.10");
    expect(hashClientIp("203.0.113.10", salt)).toBe(hashed);
  });

  it("changes when the address or salt changes", () => {
    const hashed = hashClientIp("203.0.113.10", salt);

    expect(hashClientIp("203.0.113.11", salt)).not.toBe(hashed);
    expect(hashClientIp("203.0.113.10", "another-analytics-salt")).not.toBe(hashed);
  });

  it("returns null when the address is empty", () => {
    expect(hashClientIp("   ", salt)).toBeNull();
  });
});
