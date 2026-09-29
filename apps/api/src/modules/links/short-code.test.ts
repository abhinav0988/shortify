import { generateBase62Code, isReservedShortCode, reservedShortCodes, SHORT_CODE_LENGTH } from "./short-code.js";

describe("short codes", () => {
  it("generates Base62 codes of the default length", () => {
    for (let index = 0; index < 30; index += 1) {
      expect(generateBase62Code()).toMatch(new RegExp(`^[0-9a-zA-Z]{${SHORT_CODE_LENGTH}}$`));
    }
  });

  it("treats reserved aliases as case-insensitive", () => {
    expect(isReservedShortCode("api")).toBe(true);
    expect(isReservedShortCode("API")).toBe(true);
    expect(isReservedShortCode("Dashboard")).toBe(true);
    expect(isReservedShortCode("portfolio")).toBe(false);
    expect(reservedShortCodes()).toEqual([
      "analytics",
      "api",
      "dashboard",
      "health",
      "links",
      "login",
      "metrics",
      "register",
    ]);
  });
});
