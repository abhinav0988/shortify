import type { DashboardStatsResponse, Link } from "@shortify/shared";
import { describe, expect, it } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "./App";
import { createQueryClient } from "./services/query-client";
import { getToken, setSession } from "./services/session";
import { jsonResponse, mockFetch } from "./test/mock-api";

const user = {
  id: "507f1f77bcf86cd799439011",
  name: "Ada Lovelace",
  email: "ada@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const emptyDashboard: DashboardStatsResponse = {
  totalLinks: 0,
  activeLinks: 0,
  disabledLinks: 0,
  totalClicks: 0,
  clicksToday: 0,
  recentLinks: [],
  topLinks: [],
};

const createdLink: Link = {
  id: "507f1f77bcf86cd799439012",
  shortCode: "abc1234",
  shortUrl: "http://localhost:8080/abc1234",
  originalUrl: "https://example.com/docs",
  customAlias: false,
  status: "active",
  expiresAt: null,
  totalClicks: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("frontend flows", () => {
  it("sends an unauthenticated visitor to sign in", async () => {
    renderAt("/dashboard");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeTruthy();
  });

  it("signs in and reaches the dashboard", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/api/auth/login") && init?.method === "POST") {
        return jsonResponse({ user, token: "test-token" });
      }
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ user });
      }
      if (url.endsWith("/api/dashboard/stats")) {
        return jsonResponse(emptyDashboard);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "StrongPassword123!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(getToken()).toBe("test-token");
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("logs out and removes the token", async () => {
    setSession("test-token");
    mockFetch((url) => {
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ user });
      }
      if (url.endsWith("/api/dashboard/stats")) {
        return jsonResponse(emptyDashboard);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderAt("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(getToken()).toBeNull();
  });

  it("shows a created short URL", async () => {
    setSession("test-token");
    mockFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ user });
      }
      if (url.endsWith("/api/dashboard/stats")) {
        return jsonResponse(emptyDashboard);
      }
      if (url.endsWith("/api/links") && init?.method === "POST") {
        return jsonResponse(createdLink, 201);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderAt("/dashboard");
    await userEvent.type(await screen.findByLabelText("Original URL"), "https://example.com/docs");
    await userEvent.click(screen.getByRole("button", { name: "Create short link" }));
    expect(await screen.findByText("http://localhost:8080/abc1234")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy short URL" })).toBeTruthy();
  });

  it("explains alias conflicts, rate limits, and temporary outages", async () => {
    setSession("test-token");
    const responses = [
      jsonResponse({ error: "Short code is already in use" }, 409),
      jsonResponse({ error: "Too many requests" }, 429, { "Retry-After": "12" }),
      jsonResponse({ error: "Service temporarily unavailable" }, 503),
    ];
    mockFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ user });
      }
      if (url.endsWith("/api/dashboard/stats")) {
        return jsonResponse(emptyDashboard);
      }
      if (url.endsWith("/api/links") && init?.method === "POST") {
        return responses.shift() ?? jsonResponse({ error: "Request failed" }, 500);
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    renderAt("/dashboard");
    const url = await screen.findByLabelText("Original URL");
    const alias = screen.getByLabelText("Custom alias");
    const submit = screen.getByRole("button", { name: "Create short link" });

    await userEvent.type(url, "https://example.com/docs");
    await userEvent.type(alias, "taken");
    await userEvent.click(submit);
    expect(await screen.findByText("This alias is already in use.")).toBeTruthy();

    await userEvent.click(submit);
    expect(await screen.findByText("Too many requests. Please try again in 12 seconds.")).toBeTruthy();

    await userEvent.click(submit);
    expect(await screen.findByText("Service temporarily unavailable. Please try again.")).toBeTruthy();
  });
});
