import type { AuthResponse, CurrentUserResponse, DashboardStatsResponse, ErrorResponse, Link, LinkAnalyticsResponse, ReadyHealthResponse } from "@shortify/shared";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../app.js";
import { connectRedis, disconnectRedis } from "../../cache/redis.js";
import { parseEnv, type Env } from "../../config/env.js";
import { connectMongo, disconnectMongo } from "../../database/mongoose.js";
import { buildLoggerOptions } from "../../utils/logger.js";
import { ensureLinkIndexes, LinkModel } from "../links/link.model.js";
import { UserModel } from "./user.model.js";

const password = "StrongPassword123!";
const logLines: string[] = [];

let container: StartedMongoDBContainer;
let redisContainer: StartedTestContainer | undefined;
let app: FastifyInstance;

function testEnv(mongodbUri: string, redisUrl: string): Env {
  return parseEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8080",
    MONGODB_URI: mongodbUri,
    REDIS_URL: redisUrl,
    LOG_LEVEL: "info",
    PUBLIC_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:3000",
    JWT_SECRET: "test-only-jwt-secret-value",
    ANALYTICS_IP_SALT: "test-only-analytics-salt",
    JWT_EXPIRES_IN: "1h",
    AUTH_REGISTER_RATE_LIMIT: "1000",
    AUTH_REGISTER_RATE_WINDOW_SECONDS: "60",
    AUTH_LOGIN_RATE_LIMIT: "1000",
    AUTH_LOGIN_RATE_WINDOW_SECONDS: "60",
    LINK_CREATE_RATE_LIMIT: "1000",
    LINK_CREATE_RATE_WINDOW_SECONDS: "60",
  });
}

async function register(email: string, name = "Abhinav Mangal"): Promise<AuthResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { name, email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as AuthResponse;
}

beforeAll(async () => {
  [container, redisContainer] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  const uri = `${container.getConnectionString()}/shortify?directConnection=true`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  const env = testEnv(uri, redisUrl);
  await connectMongo(env.MONGODB_URI);
  await connectRedis(redisUrl);
  await UserModel.init();
  await ensureLinkIndexes();
  app = await buildApp({
    env,
    logger: {
      ...buildLoggerOptions(env),
      stream: {
        write(message: string) {
          logLines.push(message);
        },
      },
    },
  });
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  await disconnectMongo();
  await disconnectRedis();
  if (redisContainer) {
    await redisContainer.stop();
  }
  if (container) {
    await container.stop();
  }
});

beforeEach(async () => {
  logLines.length = 0;
  await UserModel.deleteMany({});
  await LinkModel.deleteMany({});
});

describe("auth", () => {
  it("registers, logs in, and returns the current user", async () => {
    const registered = await register("abhinav@example.com");
    expect(registered.user).toMatchObject({
      name: "Abhinav Mangal",
      email: "abhinav@example.com",
    });
    expect(registered.token.length).toBeGreaterThan(20);
    expectSafe(registered, password);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "abhinav@example.com", password },
    });
    expect(login.statusCode).toBe(200);
    const loggedIn = login.json() as AuthResponse;
    expect(loggedIn.user).toEqual(registered.user);
    expectSafe(loggedIn, password);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${loggedIn.token}` },
    });
    expect(me.statusCode).toBe(200);
    const current = me.json() as CurrentUserResponse;
    expect(current.user).toEqual(registered.user);
    expectSafe(current, password);
    expect(logLines.join("\n")).not.toContain(password);
    expect(logLines.join("\n")).not.toContain(loggedIn.token);
  });

  it("normalizes email and rejects a duplicate registration", async () => {
    const registered = await register("  Abhinav@Example.com ");
    expect(registered.user.email).toBe("abhinav@example.com");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Other", email: "abhinav@example.com", password },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: "Email is already registered" });
    expect(JSON.stringify(duplicate.json())).not.toMatch(/E11000|passwordHash/i);
    expect(await UserModel.countDocuments({ email: "abhinav@example.com" })).toBe(1);
  });

  it("rejects invalid registration input", async () => {
    const invalidEmail = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Abhinav", email: "not-an-email", password },
    });
    expect(invalidEmail.statusCode).toBe(400);
    const emailBody = invalidEmail.json() as ErrorResponse;
    expect(emailBody.error).toBe("Validation failed");
    expect(emailBody.details?.some((detail) => detail.path === "email")).toBe(true);

    const invalidPassword = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Abhinav", email: "abhinav@example.com", password: "short" },
    });
    expect(invalidPassword.statusCode).toBe(400);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it("rejects unknown emails and incorrect passwords with the same response", async () => {
    await register("abhinav@example.com");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "abhinav@example.com", password: "WrongPassword123!" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "missing@example.com", password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ error: "Invalid email or password" });
    expect(unknownEmail.json()).toEqual(expect.objectContaining({ error: "Invalid email or password" }));
    expect(JSON.stringify(wrongPassword.json())).not.toContain("passwordHash");
    expect(JSON.stringify(unknownEmail.json())).not.toContain(password);
  });

  it("rejects a malformed login body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Validation failed" });
  });

  it("rejects missing, malformed, and expired tokens", async () => {
    const registered = await register("abhinav@example.com");

    const missing = await app.inject({ method: "GET", url: "/api/auth/me" });
    const malformed = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer not-a-token" },
    });
    const expiredToken = app.jwt.sign({ sub: registered.user.id }, { expiresIn: "-1s" });
    const expired = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    expect(missing.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(expired.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: "Authentication required" });
    expect(malformed.json()).toMatchObject({ error: "Authentication required" });
    expect(expired.json()).toMatchObject({ error: "Authentication required" });
  });

  it("returns 401 when the authenticated user no longer exists", async () => {
    const registered = await register("abhinav@example.com");
    await UserModel.deleteMany({ email: "abhinav@example.com" });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${registered.token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "Authentication required" });
  });

  it("keeps email uniqueness under concurrent registration", async () => {
    const responses = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: { name: "Racer", email: "race@example.com", password },
        }),
      ),
    );

    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await UserModel.countDocuments({ email: "race@example.com" })).toBe(1);
    for (const response of responses) {
      expect(JSON.stringify(response.json())).not.toContain("passwordHash");
      expect(JSON.stringify(response.json())).not.toContain(password);
    }
  });

  it("enforces a unique email index in MongoDB", async () => {
    const indexes = await UserModel.collection.indexes();
    const emailIndex = indexes.find((index) => index.key.email === 1);
    expect(emailIndex?.unique).toBe(true);

    await UserModel.create({
      name: "Ada",
      email: "index@example.com",
      passwordHash: "stored-hash-not-a-password",
    });
    await expect(
      UserModel.create({
        name: "Grace",
        email: "index@example.com",
        passwordHash: "another-stored-hash",
      }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(await UserModel.countDocuments({ email: "index@example.com" })).toBe(1);
  });

  it("allows browser preflight for link updates and deletes", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/links/507f1f77bcf86cd799439011",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("reports health while Redis is connected", async () => {
    const root = await app.inject({ method: "GET", url: "/" });
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });

    expect(root.statusCode).toBe(200);
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: "ok",
      checks: { mongodb: "up", redis: "up" },
    } satisfies Partial<ReadyHealthResponse>);
  });

  it("completes register, login, create, redirect, analytics, and dashboard", async () => {
    await register("flow-a@example.com", "Flow A");
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "flow-a@example.com", password },
    });
    expect(login.statusCode).toBe(200);
    const token = (login.json() as AuthResponse).token;

    const created = await app.inject({
      method: "POST",
      url: "/api/links",
      headers: { authorization: `Bearer ${token}` },
      payload: { originalUrl: "https://example.com/flow-a", customAlias: "flowA01" },
    });
    expect(created.statusCode).toBe(201);
    const link = created.json() as Link;

    const redirected = await app.inject({ method: "GET", url: "/flowA01" });
    expect(redirected.statusCode).toBe(302);
    expect(redirected.headers.location).toBe("https://example.com/flow-a");

    const analytics = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(analytics.statusCode).toBe(200);
    const analyticsBody = analytics.json() as LinkAnalyticsResponse;
    expect(analyticsBody.summary.clicks).toBe(1);
    expect(analyticsBody.link.totalClicks).toBe(1);
    expect(JSON.stringify(analyticsBody)).not.toContain("ipHash");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard/stats",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toMatchObject({
      totalLinks: 1,
      totalClicks: 1,
      clicksToday: 1,
    } satisfies Partial<DashboardStatsResponse>);
  });

  it("keeps malformed identifiers, unsupported methods, oversized bodies, and foreign origins controlled", async () => {
    const registered = await register("boundaries@example.com");

    const malformed = await app.inject({
      method: "GET",
      url: "/api/links/not-an-object-id",
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toMatchObject({ error: "Link not found" });
    expect(JSON.stringify(malformed.json())).not.toMatch(/CastError|stack/i);

    const unsupportedLogin = await app.inject({ method: "GET", url: "/api/auth/login" });
    expect(unsupportedLogin.statusCode).toBe(404);

    const unsupportedUpdate = await app.inject({
      method: "PUT",
      url: `/api/links/${registered.user.id}`,
      headers: { authorization: `Bearer ${registered.token}` },
      payload: { originalUrl: "https://example.com/put" },
    });
    expect(unsupportedUpdate.statusCode).toBe(404);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "boundaries@example.com", password: "x".repeat(40_000) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ error: "Request body is too large" });
    expect(JSON.stringify(oversized.json())).not.toMatch(/\n/);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/health/live",
      headers: { origin: "http://localhost:3000" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["cross-origin-resource-policy"]).toBe("cross-origin");

    const foreign = await app.inject({
      method: "GET",
      url: "/api/health/live",
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
    expect(foreign.statusCode).toBe(200);
  });

  it("does not log passwords or password hashes", async () => {
    const secretPassword = "LogSafePassword123";
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Logger", email: "logger@example.com", password: secretPassword },
    });
    expect(response.statusCode).toBe(201);

    const stored = await UserModel.findOne({ email: "logger@example.com" }).select("+passwordHash");
    const token = (response.json() as AuthResponse).token;
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);

    const logs = logLines.join("\n");
    expect(logs).not.toContain(secretPassword);
    expect(logs).not.toContain(stored?.passwordHash ?? "missing-hash");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("passwordHash");
  });
});

function expectSafe(body: unknown, plaintextPassword: string): void {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("passwordHash");
  expect(serialized).not.toContain(plaintextPassword);
  expect(serialized).not.toContain("$argon2");
}
