import { jest } from "@jest/globals";
import argon2 from "argon2";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../app.js";
import { getRedis, connectRedis, disconnectRedis } from "./redis.js";
import { RATE_LIMIT_UNAVAILABLE } from "./rate-limit.js";
import { parseEnv, type Env } from "../config/env.js";
import { connectMongo, disconnectMongo } from "../database/mongoose.js";
import { UserModel } from "../modules/auth/user.model.js";
import { ensureLinkIndexes, LinkModel } from "../modules/links/link.model.js";

const password = "StrongPassword123!";

let mongo: StartedMongoDBContainer;
let redisContainer: StartedTestContainer | undefined;
let app: FastifyInstance;
let appB: FastifyInstance;
let mongoUri = "";
let redisUrl = "";
let addressOctet = 10;

function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8080",
    MONGODB_URI: mongoUri,
    REDIS_URL: redisUrl,
    LOG_LEVEL: "silent",
    PUBLIC_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:3000",
    JWT_SECRET: "test-only-jwt-secret-value",
    ANALYTICS_IP_SALT: "test-only-analytics-salt",
    JWT_EXPIRES_IN: "1h",
    AUTH_REGISTER_RATE_LIMIT: "2",
    AUTH_REGISTER_RATE_WINDOW_SECONDS: "60",
    AUTH_LOGIN_RATE_LIMIT: "2",
    AUTH_LOGIN_RATE_WINDOW_SECONDS: "60",
    LINK_CREATE_RATE_LIMIT: "2",
    LINK_CREATE_RATE_WINDOW_SECONDS: "60",
    ...overrides,
  });
}

function nextAddress(): string {
  addressOctet += 1;
  return `198.51.100.${addressOctet}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function remainingWindowMs(windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  return windowMs - (Date.now() % windowMs);
}

async function ensureWindowRoom(windowSeconds: number, neededMs: number): Promise<void> {
  const remaining = remainingWindowMs(windowSeconds);
  if (remaining < neededMs) {
    await sleep(remaining + 30);
  }
}

function redisClient(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new Error("redis is not connected");
  }
  return redis;
}

async function deleteRateLimitKeys(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "shortify:ratelimit:*", "COUNT", 100);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

async function register(target: FastifyInstance, address: string, email: string) {
  return target.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: address,
    payload: { name: "Rate Limit", email, password },
  });
}

async function createOwner(email: string): Promise<{ id: string; token: string }> {
  const user = await UserModel.create({
    name: "Link Owner",
    email,
    passwordHash: "not-used-for-login",
  });
  return {
    id: user._id.toString(),
    token: app.jwt.sign({ sub: user._id.toString() }),
  };
}

beforeAll(async () => {
  [mongo, redisContainer] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  mongoUri = `${mongo.getConnectionString()}/shortify?directConnection=true`;
  redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  const env = testEnv();
  await connectMongo(env.MONGODB_URI);
  await connectRedis(redisUrl);
  await UserModel.init();
  await ensureLinkIndexes();
  app = await buildApp({ env, logger: false });
  appB = await buildApp({ env, logger: false });
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  if (appB) {
    await appB.close();
  }
  await disconnectMongo();
  await disconnectRedis();
  if (redisContainer) {
    await redisContainer.stop();
  }
  if (mongo) {
    await mongo.stop();
  }
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await LinkModel.deleteMany({});
  await deleteRateLimitKeys();
});

describe("distributed rate limiting", () => {
  it("limits registration by client address and resets on the next window", async () => {
    const windowSeconds = 4;
    const windowApp = await buildApp({
      env: testEnv({
        AUTH_REGISTER_RATE_LIMIT: "2",
        AUTH_REGISTER_RATE_WINDOW_SECONDS: String(windowSeconds),
      }),
      logger: false,
    });
    const hash = jest.spyOn(argon2, "hash");

    try {
      await ensureWindowRoom(windowSeconds, 3_000);
      const address = nextAddress();
      const hashesBefore = hash.mock.calls.length;
      const invalid = await windowApp.inject({
        method: "POST",
        url: "/api/auth/register",
        remoteAddress: address,
        payload: {},
      });
      const first = await register(windowApp, address, "one@example.com");
      const second = await register(windowApp, address, "two@example.com");
      const blocked = await register(windowApp, address, "three@example.com");

      expect(invalid.statusCode).toBe(400);
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: "Too many requests" });
      expect(blocked.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(windowSeconds);
      expect(await UserModel.countDocuments({ email: "three@example.com" })).toBe(0);
      expect(hash.mock.calls.length).toBe(hashesBefore + 2);
      expect(JSON.stringify(blocked.json())).not.toContain(password);

      const keys = await rateLimitKeys();
      expect(keys.some((key) => key.startsWith("shortify:ratelimit:register:"))).toBe(true);
      const registerKey = keys.find((key) => key.startsWith("shortify:ratelimit:register:"));
      const ttl = await redisClient().ttl(registerKey ?? "");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(windowSeconds);

      await sleep(remainingWindowMs(windowSeconds) + 50);
      const again = await register(windowApp, address, "four@example.com");
      expect(again.statusCode).toBe(201);
    } finally {
      hash.mockRestore();
      await windowApp.close();
    }
  });

  it("keeps unknown emails and wrong passwords identical until the login limit is exceeded", async () => {
    const address = nextAddress();
    await register(app, nextAddress(), "known@example.com");
    const verify = jest.spyOn(argon2, "verify");
    const verifiesBefore = verify.mock.calls.length;

    try {
      const wrong = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: address,
        payload: { email: "known@example.com", password: "wrong-password" },
      });
      const unknown = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: address,
        payload: { email: "missing@example.com", password: "wrong-password" },
      });
      const blocked = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: address,
        payload: { email: "known@example.com", password },
      });

      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.json()).toMatchObject({ error: "Invalid email or password" });
      expect(unknown.json()).toMatchObject({ error: "Invalid email or password" });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
      expect(verify.mock.calls.length).toBe(verifiesBefore + 2);
    } finally {
      verify.mockRestore();
    }

    const allowed = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: nextAddress(),
      payload: { email: "known@example.com", password },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("limits link creation per user and leaves other users unaffected", async () => {
    const first = await createOwner("first-owner@example.com");
    const second = await createOwner("second-owner@example.com");

    const created = [];
    for (const alias of ["owner-a1", "owner-a2"]) {
      created.push(
        await app.inject({
          method: "POST",
          url: "/api/links",
          headers: { authorization: `Bearer ${first.token}` },
          payload: { originalUrl: "https://example.com/a", customAlias: alias },
        }),
      );
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/links",
      headers: { authorization: `Bearer ${first.token}` },
      payload: { originalUrl: "https://example.com/a", customAlias: "owner-a3" },
    });
    const other = await app.inject({
      method: "POST",
      url: "/api/links",
      headers: { authorization: `Bearer ${second.token}` },
      payload: { originalUrl: "https://example.com/b", customAlias: "owner-b1" },
    });

    expect(created.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
    expect(other.statusCode).toBe(201);
    expect(await LinkModel.countDocuments({ shortCode: "owner-a3" })).toBe(0);

    const listed = await app.inject({
      method: "GET",
      url: "/api/links",
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(listed.statusCode).toBe(200);
  });

  it("enforces one shared Redis counter across two API instances", async () => {
    await ensureWindowRoom(60, 5_000);
    const address = nextAddress();
    const first = await register(app, address, "instance-a@example.com");
    const second = await register(appB, address, "instance-b@example.com");
    const third = await register(app, address, "instance-c@example.com");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(429);

    const keys = (await rateLimitKeys()).filter((key) => key.startsWith("shortify:ratelimit:register:"));
    expect(keys).toHaveLength(1);
    expect(Number(await redisClient().get(keys[0] ?? ""))).toBe(3);
    const ttl = await redisClient().ttl(keys[0] ?? "");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await redisClient().del(keys[0] ?? "");
    const fourth = await register(appB, address, "instance-d@example.com");
    expect(fourth.statusCode).toBe(201);
  });

  it("allows exactly the configured number of concurrent registrations", async () => {
    const limited = await buildApp({
      env: testEnv({ AUTH_REGISTER_RATE_LIMIT: "5" }),
      logger: false,
    });

    try {
      await ensureWindowRoom(60, 10_000);
      const address = nextAddress();
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_value, index) => register(limited, address, `concurrent-${index}@example.com`)),
      );
      expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(5);
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(5);
      expect(await UserModel.countDocuments({ email: /^concurrent-/ })).toBe(5);
    } finally {
      await limited.close();
    }
  });

  it("does not trust X-Forwarded-For when choosing the client address", async () => {
    const address = nextAddress();
    expect((await register(app, address, "proxy-a@example.com")).statusCode).toBe(201);
    expect((await register(app, address, "proxy-b@example.com")).statusCode).toBe(201);
    const forwarded = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: address,
      headers: { "x-forwarded-for": "203.0.113.50" },
      payload: { name: "Rate Limit", email: "proxy-c@example.com", password },
    });
    expect(forwarded.statusCode).toBe(429);
  });

  it("fails closed when a rate-limit command fails and hides Redis details", async () => {
    const redis = redisClient();
    const evalSpy = jest.spyOn(redis, "eval").mockRejectedValueOnce(new Error("ECONNREFUSED 10.9.8.7:6379"));

    try {
      const response = await register(app, nextAddress(), "hidden@example.com");
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: RATE_LIMIT_UNAVAILABLE });
      const body = JSON.stringify(response.json());
      expect(body).not.toContain("10.9.8.7");
      expect(body).not.toContain("ECONNREFUSED");
      expect(await UserModel.countDocuments({ email: "hidden@example.com" })).toBe(0);
    } finally {
      evalSpy.mockRestore();
    }
  });

  it("fails closed for protected writes and still redirects when Redis is down", async () => {
    const owner = await createOwner("outage-owner@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "outagego",
      originalUrl: "https://example.com/outage",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });
    const usersBefore = await UserModel.countDocuments();
    const linksBefore = await LinkModel.countDocuments();

    await disconnectRedis();
    try {
      const redirected = await app.inject({ method: "GET", url: "/outagego" });
      expect(redirected.statusCode).toBe(302);
      expect(redirected.headers.location).toBe("https://example.com/outage");

      const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({ checks: { mongodb: "up", redis: "down" } });

      const registered = await register(app, nextAddress(), "outage-register@example.com");
      const loggedIn = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: nextAddress(),
        payload: { email: "outage-owner@example.com", password: "whatever-1" },
      });
      const created = await app.inject({
        method: "POST",
        url: "/api/links",
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { originalUrl: "https://example.com/new", customAlias: "outrange" },
      });
      const unauthenticated = await app.inject({
        method: "POST",
        url: "/api/links",
        payload: { originalUrl: "https://example.com/new" },
      });
      const listed = await app.inject({
        method: "GET",
        url: "/api/links",
        headers: { authorization: `Bearer ${owner.token}` },
      });
      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(registered.statusCode).toBe(503);
      expect(loggedIn.statusCode).toBe(503);
      expect(created.statusCode).toBe(503);
      expect(registered.json()).toMatchObject({ error: RATE_LIMIT_UNAVAILABLE });
      expect(loggedIn.json()).toMatchObject({ error: RATE_LIMIT_UNAVAILABLE });
      expect(created.json()).toMatchObject({ error: RATE_LIMIT_UNAVAILABLE });
      expect(unauthenticated.statusCode).toBe(401);
      expect(listed.statusCode).toBe(200);
      expect(me.statusCode).toBe(200);
      expect(await UserModel.countDocuments()).toBe(usersBefore);
      expect(await LinkModel.countDocuments()).toBe(linksBefore);
    } finally {
      await connectRedis(redisUrl);
    }
  });
});

async function rateLimitKeys(): Promise<string[]> {
  const redis = redisClient();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "shortify:ratelimit:*", "COUNT", 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
