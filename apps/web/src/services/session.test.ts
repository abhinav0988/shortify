import { describe, expect, it } from "vitest";
import { clearSession, getToken, setSession } from "./session";

describe("session", () => {
  it("stores and clears the access token", () => {
    setSession("abc");
    expect(getToken()).toBe("abc");
    expect(localStorage.getItem("shortify.accessToken")).toBe("abc");
    clearSession();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("shortify.accessToken")).toBeNull();
  });
});
