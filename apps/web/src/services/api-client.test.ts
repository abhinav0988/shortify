import { describe, expect, it } from "vitest";
import { apiRequest } from "./api-client";
import { getToken, setSession } from "./session";
import { jsonResponse, mockFetch } from "../test/mock-api";

describe("api client", () => {
  it("sends the bearer token and clears it after 401", async () => {
    setSession("session-token");
    const fetchMock = mockFetch(() => jsonResponse({ error: "Authentication required" }, 401));

    await expect(apiRequest("/api/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("does not attach a token to login", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ error: "Invalid email or password" }, 401));
    await expect(apiRequest("/api/auth/login", { method: "POST", body: { email: "a@b.co", password: "nope" }, token: null })).rejects.toMatchObject({
      status: 401,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(getToken()).toBeNull();
  });

  it("reads Retry-After on 429", async () => {
    mockFetch(() => jsonResponse({ error: "Too many requests" }, 429, { "Retry-After": "9" }));
    await expect(apiRequest("/api/links", { method: "POST", body: { originalUrl: "https://example.com" } })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 9,
    });
  });
});
