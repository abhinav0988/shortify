import { parseEnv } from "./env.js";

const validEnv = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "8080",
  MONGODB_URI: "mongodb://localhost:27017/shortify",
  REDIS_URL: "redis://localhost:6379",
  LOG_LEVEL: "silent",
  PUBLIC_BASE_URL: "http://localhost:8080",
  CORS_ORIGIN: "http://localhost:3000",
  JWT_SECRET: "test-only-jwt-secret-value",
  ANALYTICS_IP_SALT: "test-only-analytics-salt",
};

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv(validEnv);

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(8080);
    expect(env.MONGODB_URI).toBe(validEnv.MONGODB_URI);
    expect(env.PUBLIC_BASE_URL).toBe(validEnv.PUBLIC_BASE_URL);
    expect(env.JWT_EXPIRES_IN).toBe("1d");
    expect(env.ANALYTICS_IP_SALT).toBe("test-only-analytics-salt");
    expect(env.REDIRECT_CACHE_TTL_SECONDS).toBe(300);
    expect(env.AUTH_REGISTER_RATE_LIMIT).toBe(5);
    expect(env.AUTH_REGISTER_RATE_WINDOW_SECONDS).toBe(60);
    expect(env.AUTH_LOGIN_RATE_LIMIT).toBe(10);
    expect(env.AUTH_LOGIN_RATE_WINDOW_SECONDS).toBe(60);
    expect(env.LINK_CREATE_RATE_LIMIT).toBe(10);
    expect(env.LINK_CREATE_RATE_WINDOW_SECONDS).toBe(60);
  });

  it("accepts a redirect cache ttl override", () => {
    const env = parseEnv({ ...validEnv, REDIRECT_CACHE_TTL_SECONDS: "45" });
    expect(env.REDIRECT_CACHE_TTL_SECONDS).toBe(45);
  });

  it("rejects a non-positive redirect cache ttl", () => {
    expect(() => parseEnv({ ...validEnv, REDIRECT_CACHE_TTL_SECONDS: "0" })).toThrow(/REDIRECT_CACHE_TTL_SECONDS/);
  });

  it("rejects a non-positive rate limit", () => {
    expect(() => parseEnv({ ...validEnv, AUTH_LOGIN_RATE_LIMIT: "0" })).toThrow(/AUTH_LOGIN_RATE_LIMIT/);
    expect(() => parseEnv({ ...validEnv, LINK_CREATE_RATE_WINDOW_SECONDS: "-1" })).toThrow(
      /LINK_CREATE_RATE_WINDOW_SECONDS/,
    );
  });

  it("rejects a short analytics salt", () => {
    expect(() => parseEnv({ ...validEnv, ANALYTICS_IP_SALT: "too-short" })).toThrow(/ANALYTICS_IP_SALT/);
  });

  it("throws when MONGODB_URI is missing", () => {
    const source: NodeJS.ProcessEnv = { ...validEnv };
    delete source.MONGODB_URI;

    expect(() => parseEnv(source)).toThrow(/MONGODB_URI/);
  });
});
