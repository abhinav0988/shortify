import { hashClientAddress, rateLimitKey, rateLimitWindowId } from "./rate-limit.js";

describe("rate limit keys", () => {
  it("namespaces limiter keys separately from redirect cache keys", () => {
    const key = rateLimitKey("login", "abc123", 42);

    expect(key).toBe("shortify:ratelimit:login:abc123:42");
    expect(key.startsWith("shortify:redirect:")).toBe(false);
    expect(rateLimitKey("register", "abc123", 42)).not.toBe(key);
    expect(rateLimitKey("link-create", "abc123", 42)).not.toBe(key);
  });

  it("aligns a fixed window to whole seconds", () => {
    expect(rateLimitWindowId(0, 60)).toBe(0);
    expect(rateLimitWindowId(59_999, 60)).toBe(0);
    expect(rateLimitWindowId(60_000, 60)).toBe(1);
  });

  it("stores a keyed hash of the client address instead of the raw address", () => {
    const secret = "test-only-jwt-secret-value";
    const hashed = hashClientAddress("203.0.113.9", secret);

    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.9");
    expect(hashClientAddress("203.0.113.9", secret)).toBe(hashed);
    expect(hashClientAddress("203.0.113.10", secret)).not.toBe(hashed);
    expect(hashClientAddress("203.0.113.9", "another-test-secret-value")).not.toBe(hashed);
  });
});
