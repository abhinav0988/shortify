import {
  isCachedRedirectCurrent,
  isRedirectHttpUrl,
  parseCachedRedirect,
  redirectCacheKey,
  redirectCacheTtlSeconds,
} from "./redirect-cache.js";

describe("redirect cache keys and ttl", () => {
  it("keeps short-code case in the cache key", () => {
    expect(redirectCacheKey("abc")).toBe("shortify:redirect:abc");
    expect(redirectCacheKey("AbC")).toBe("shortify:redirect:AbC");
    expect(redirectCacheKey("abc")).not.toBe(redirectCacheKey("AbC"));
  });

  it("uses the configured ttl when the link does not expire", () => {
    expect(redirectCacheTtlSeconds(null, new Date("2026-01-01T00:00:00.000Z"), 300)).toBe(300);
  });

  it("caps ttl at the whole seconds remaining before expiresAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 10_900);

    expect(redirectCacheTtlSeconds(expiresAt, now, 300)).toBe(10);
    expect(redirectCacheTtlSeconds(expiresAt, now, 5)).toBe(5);
  });

  it("returns 0 when the link is expired or has less than one second left", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    expect(redirectCacheTtlSeconds(new Date(now.getTime() - 1), now, 300)).toBe(0);
    expect(redirectCacheTtlSeconds(now, now, 300)).toBe(0);
    expect(redirectCacheTtlSeconds(new Date(now.getTime() + 400), now, 300)).toBe(0);
  });
});

describe("redirect cache payload", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("accepts a versioned http location", () => {
    const raw = JSON.stringify({
      v: 2,
      linkId: "507f1f77bcf86cd799439011",
      location: "https://example.com/products/123?keep=1",
      expiresAt: null,
    });

    expect(parseCachedRedirect(raw)).toEqual({
      v: 2,
      linkId: "507f1f77bcf86cd799439011",
      location: "https://example.com/products/123?keep=1",
      expiresAt: null,
    });
    expect(isCachedRedirectCurrent(parseCachedRedirect(raw)!, now)).toBe(true);
  });

  it("rejects malformed json, unexpected versions, and non-http locations", () => {
    expect(parseCachedRedirect("not-json")).toBeNull();
    expect(parseCachedRedirect(JSON.stringify({ v: 1, linkId: "507f1f77bcf86cd799439011", location: "https://example.com", expiresAt: null }))).toBeNull();
    expect(parseCachedRedirect(JSON.stringify({ v: 2, location: "https://example.com", expiresAt: null }))).toBeNull();
    expect(parseCachedRedirect(JSON.stringify({ v: 2, linkId: "507f1f77bcf86cd799439011", location: "javascript:alert(1)", expiresAt: null }))).toBeNull();
    expect(parseCachedRedirect(JSON.stringify({ v: 2, linkId: "507f1f77bcf86cd799439011", location: "data:text/html,hi", expiresAt: null }))).toBeNull();
    expect(parseCachedRedirect(JSON.stringify({ v: 2, linkId: "507f1f77bcf86cd799439011", location: "file:///tmp/secret", expiresAt: null }))).toBeNull();
    expect(isRedirectHttpUrl("https://example.com/path")).toBe(true);
    expect(isRedirectHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("treats a cached expiration in the past as unusable", () => {
    const entry = parseCachedRedirect(
      JSON.stringify({
        v: 2,
        linkId: "507f1f77bcf86cd799439011",
        location: "https://example.com/stale",
        expiresAt: "2025-12-31T23:59:59.000Z",
      }),
    );

    expect(entry).not.toBeNull();
    expect(isCachedRedirectCurrent(entry!, now)).toBe(false);
  });
});
