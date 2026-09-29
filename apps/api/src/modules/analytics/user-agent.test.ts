import { classifyUserAgent } from "./user-agent.js";

describe("classifyUserAgent", () => {
  it("treats a missing agent as unknown", () => {
    expect(classifyUserAgent("")).toEqual({ device: "unknown", browser: "unknown" });
    expect(classifyUserAgent(null)).toEqual({ device: "unknown", browser: "unknown" });
  });

  it("classifies common desktop and mobile agents approximately", () => {
    expect(classifyUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36")).toEqual({
      device: "desktop",
      browser: "chrome",
    });
    expect(classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toEqual({
      device: "mobile",
      browser: "other",
    });
    expect(classifyUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148")).toEqual({
      device: "tablet",
      browser: "other",
    });
    expect(classifyUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0")).toEqual({
      device: "desktop",
      browser: "edge",
    });
    expect(classifyUserAgent("Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0")).toEqual({
      device: "desktop",
      browser: "firefox",
    });
    expect(classifyUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toEqual({
      device: "desktop",
      browser: "safari",
    });
  });

  it("classifies a crawler as a bot", () => {
    expect(classifyUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toEqual({
      device: "bot",
      browser: "other",
    });
  });
});
