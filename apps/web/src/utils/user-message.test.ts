import { describe, expect, it } from "vitest";
import { ApiError } from "../services/api-client";
import { userMessage } from "./user-message";

describe("user messages", () => {
  it("uses validation details for 400", () => {
    const error = new ApiError(400, "Validation failed", [{ path: "originalUrl", message: "Only http and https URLs are allowed" }]);
    expect(userMessage(error)).toBe("Only http and https URLs are allowed");
  });

  it("describes alias conflicts, rate limits, and unavailable service", () => {
    expect(userMessage(new ApiError(409, "Short code is already in use"))).toBe("This alias is already in use.");
    expect(userMessage(new ApiError(429, "Too many requests", [], 12))).toBe("Too many requests. Please try again in 12 seconds.");
    expect(userMessage(new ApiError(429, "Too many requests"))).toBe("Too many requests. Please try again shortly.");
    expect(userMessage(new ApiError(503, "Service temporarily unavailable"))).toBe("Service temporarily unavailable. Please try again.");
    expect(userMessage(new ApiError(500, "stack trace should not leak"))).toBe("Something went wrong. Please try again.");
    expect(userMessage(new ApiError(404, "Link not found"))).toBe("That resource is not available.");
  });

  it("keeps invalid credentials distinct from a signed-out session", () => {
    expect(userMessage(new ApiError(401, "Invalid email or password"), "credentials")).toBe("Invalid email or password.");
    expect(userMessage(new ApiError(401, "Authentication required"))).toBe("Sign in to continue.");
  });
});
