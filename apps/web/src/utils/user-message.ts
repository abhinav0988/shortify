import { ApiError } from "../services/api-client";

export function userMessage(error: unknown, context?: "credentials"): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  if (error.status === 0) {
    return error.message;
  }

  if (error.status === 400) {
    if (error.details.length > 0) {
      return error.details.map((detail) => detail.message).join(" ");
    }
    return error.message || "Check the form and try again.";
  }

  if (error.status === 401) {
    return context === "credentials" ? "Invalid email or password." : "Sign in to continue.";
  }

  if (error.status === 404) {
    return "That resource is not available.";
  }

  if (error.status === 409) {
    const normalized = error.message.toLowerCase();
    if (normalized.includes("short code") || normalized.includes("alias")) {
      return "This alias is already in use.";
    }
    return error.message;
  }

  if (error.status === 429) {
    if (error.retryAfterSeconds !== null && error.retryAfterSeconds > 0) {
      return `Too many requests. Please try again in ${error.retryAfterSeconds} seconds.`;
    }
    return "Too many requests. Please try again shortly.";
  }

  if (error.status === 503) {
    return "Service temporarily unavailable. Please try again.";
  }

  if (error.status >= 500) {
    return "Something went wrong. Please try again.";
  }

  return error.message || "Request failed.";
}
