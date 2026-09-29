import type { Link } from "@shortify/shared";
import { jest } from "@jest/globals";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { Types } from "mongoose";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../app.js";
import { getRedis, connectRedis, disconnectRedis } from "../../cache/redis.js";
import { RATE_LIMIT_UNAVAILABLE } from "../../cache/rate-limit.js";
import {
  REDIRECT_CACHE_UNAVAILABLE,
  redirectCacheKey,
} from "../../cache/redirect-cache.js";
import { parseEnv, type Env } from "../../config/env.js";
import { connectMongo, disconnectMongo } from "../../database/mongoose.js";
import { UserModel } from "../auth/user.model.js";
import { ensureLinkIndexes, LinkModel } from "../links/link.model.js";
import { resolveShortCode } from "./redirect.service.js";

const CACHE_TTL_SECONDS = 45;

let mongo: StartedMongoDBContainer;
let redisContainer: StartedTestContainer | undefined;
let app: FastifyInstance;
let redisUrl = "";
let mongoUri = "";

function testEnv(mongodbUri: string): Env {
  return parseEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8080",
    MONGODB_URI: mongodbUri,
    REDIS_URL: redisUrl,
    LOG_LEVEL: "silent",
    PUBLIC_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:3000",
    JWT_SECRET: "test-only-jwt-secret-value",
    ANALYTICS_IP_SALT: "test-only-analytics-salt",
    JWT_EXPIRES_IN: "1h",
    REDIRECT_CACHE_TTL_SECONDS: String(CACHE_TTL_SECONDS),
  });
}

function redisClient(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new Error("redis is not connected");
  }
  return redis;
}

async function insertLink(input: {
  shortCode: string;
  originalUrl?: string;
  status?: "active" | "disabled";
  expiresAt?: Date | null;
}): Promise<void> {
  await LinkModel.create({
    userId: new Types.ObjectId(),
    shortCode: input.shortCode,
    originalUrl: input.originalUrl ?? "https://example.com/products/123?keep=1",
    customAlias: true,
    status: input.status ?? "active",
    expiresAt: input.expiresAt ?? null,
    totalClicks: 0,
  });
}

async function createUser(email: string): Promise<{ id: string; token: string }> {
  const user = await UserModel.create({
    name: "Cache Owner",
    email,
    passwordHash: "not-used-for-login",
  });
  return {
    id: user._id.toString(),
    token: app.jwt.sign({ sub: user._id.toString() }),
  };
}

function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function postLink(token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/links",
    headers: authHeader(token),
    payload,
  });
}

beforeAll(async () => {
  [mongo, redisContainer] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  mongoUri = `${mongo.getConnectionString()}/shortify?directConnection=true`;
  const env = testEnv(mongoUri);
  await connectMongo(env.MONGODB_URI);
  await connectRedis(redisUrl);
  await ensureLinkIndexes();
  app = await buildApp({ env, logger: false });
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
  if (mongo) {
    await mongo.stop();
  }
});

beforeEach(async () => {
  await LinkModel.deleteMany({});
  await UserModel.deleteMany({});
  await redisClient().flushdb();
});

describe("redirect cache", () => {
  it("fills the cache on a miss and serves the next redirect without MongoDB", async () => {
    const owner = await createUser("miss@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/products/123?keep=1",
      customAlias: "cacheHit",
    });
    expect(created.statusCode).toBe(201);
    expect(await redisClient().get(redirectCacheKey("cacheHit"))).toBeNull();

    const first = await app.inject({ method: "GET", url: "/cacheHit?tracking=1" });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe("https://example.com/products/123?keep=1");
    expect(first.body).toBe("");
    const link = created.json() as Link;
    expect(JSON.parse((await redisClient().get(redirectCacheKey("cacheHit"))) ?? "null")).toEqual({
      v: 2,
      linkId: link.id,
      location: "https://example.com/products/123?keep=1",
      expiresAt: null,
    });
    expect((await LinkModel.findOne({ shortCode: "cacheHit" }))?.totalClicks).toBe(1);

    await LinkModel.deleteOne({ shortCode: "cacheHit" });
    const second = await app.inject({ method: "GET", url: "/cacheHit?other=2" });
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toBe("https://example.com/products/123?keep=1");
    expect(await LinkModel.countDocuments({ shortCode: "cacheHit" })).toBe(0);
  });

  it("uses the configured ttl for a non-expiring link and a shorter ttl before expiresAt", async () => {
    await insertLink({ shortCode: "steady1", originalUrl: "https://example.com/steady" });
    const steady = await app.inject({ method: "GET", url: "/steady1" });
    expect(steady.statusCode).toBe(302);
    const steadyTtl = await redisClient().ttl(redirectCacheKey("steady1"));
    expect(steadyTtl).toBeGreaterThan(40);
    expect(steadyTtl).toBeLessThanOrEqual(CACHE_TTL_SECONDS);

    const expiresAt = new Date(Date.now() + 20_000);
    await insertLink({
      shortCode: "soonExp",
      originalUrl: "https://example.com/soon",
      expiresAt,
    });
    const soon = await app.inject({ method: "GET", url: "/soonExp" });
    expect(soon.statusCode).toBe(302);
    expect(soon.headers.location).toBe("https://example.com/soon");
    const soonTtl = await redisClient().ttl(redirectCacheKey("soonExp"));
    expect(soonTtl).toBeGreaterThan(5);
    expect(soonTtl).toBeLessThanOrEqual(20);
    expect(soonTtl).toBeLessThan(CACHE_TTL_SECONDS);

    const briefExpiresAt = new Date(Date.now() + 60_000);
    await insertLink({ shortCode: "brief01", originalUrl: "https://example.com/brief", expiresAt: briefExpiresAt });
    const brief = await resolveShortCode("brief01", {
      now: new Date(briefExpiresAt.getTime() - 400),
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    });
    expect(brief).toMatchObject({ location: "https://example.com/brief" });
    expect(await redisClient().get(redirectCacheKey("brief01"))).toBeNull();

    const expired = await resolveShortCode("brief01", {
      now: briefExpiresAt,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    });
    expect(expired).toBeNull();
    expect(await redisClient().get(redirectCacheKey("brief01"))).toBeNull();
  });

  it("does not cache missing, disabled, or expired codes", async () => {
    await insertLink({ shortCode: "paused1", status: "disabled" });
    await insertLink({ shortCode: "expired", expiresAt: new Date(Date.now() - 60_000) });

    for (const url of ["/missing1", "/paused1", "/expired", "/zz"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.headers.location).toBeUndefined();
      expect(response.json()).toMatchObject({ error: "Short link not found" });
    }

    expect(await redisClient().get(redirectCacheKey("missing1"))).toBeNull();
    expect(await redisClient().get(redirectCacheKey("paused1"))).toBeNull();
    expect(await redisClient().get(redirectCacheKey("expired"))).toBeNull();
    expect(await redisClient().get(redirectCacheKey("zz"))).toBeNull();
  });

  it("keeps separate cache entries for different short-code case", async () => {
    await insertLink({ shortCode: "abc", originalUrl: "https://example.com/lower" });
    await insertLink({ shortCode: "AbC", originalUrl: "https://example.com/mixed" });

    const lower = await app.inject({ method: "GET", url: "/abc" });
    const mixed = await app.inject({ method: "GET", url: "/AbC" });
    expect(lower.headers.location).toBe("https://example.com/lower");
    expect(mixed.headers.location).toBe("https://example.com/mixed");

    const lowerEntry = JSON.parse((await redisClient().get(redirectCacheKey("abc"))) ?? "null") as { location: string };
    const mixedEntry = JSON.parse((await redisClient().get(redirectCacheKey("AbC"))) ?? "null") as { location: string };
    expect(lowerEntry.location).toBe("https://example.com/lower");
    expect(mixedEntry.location).toBe("https://example.com/mixed");
  });

  it("ignores a cached entry that is malformed, non-http, or already expired", async () => {
    await insertLink({ shortCode: "badjson", originalUrl: "https://example.com/from-mongo" });
    await insertLink({ shortCode: "badprot", originalUrl: "https://example.com/safe" });
    await insertLink({ shortCode: "stale01", originalUrl: "https://example.com/current" });

    await redisClient().set(redirectCacheKey("badjson"), "not-json", "EX", 60);
    await redisClient().set(
      redirectCacheKey("badprot"),
      JSON.stringify({
        v: 2,
        linkId: "507f1f77bcf86cd799439011",
        location: "javascript:alert(1)",
        expiresAt: null,
      }),
      "EX",
      60,
    );
    await redisClient().set(
      redirectCacheKey("stale01"),
      JSON.stringify({
        v: 2,
        linkId: "507f1f77bcf86cd799439011",
        location: "https://example.com/stale",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      "EX",
      60,
    );

    const malformed = await app.inject({ method: "GET", url: "/badjson" });
    const protocol = await app.inject({ method: "GET", url: "/badprot" });
    const stale = await app.inject({ method: "GET", url: "/stale01" });

    expect(malformed.statusCode).toBe(302);
    expect(malformed.headers.location).toBe("https://example.com/from-mongo");
    expect(protocol.statusCode).toBe(302);
    expect(protocol.headers.location).toBe("https://example.com/safe");
    expect(stale.statusCode).toBe(302);
    expect(stale.headers.location).toBe("https://example.com/current");
    expect(JSON.parse((await redisClient().get(redirectCacheKey("badprot"))) ?? "null")).toMatchObject({
      location: "https://example.com/safe",
    });
  });

  it("replaces the cached destination when originalUrl changes", async () => {
    const owner = await createUser("dest@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/old",
      customAlias: "destold",
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/destold" })).headers.location).toBe("https://example.com/old");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { originalUrl: "https://example.com/new" },
    });
    expect(updated.statusCode).toBe(200);
    expect(await redisClient().get(redirectCacheKey("destold"))).toBeNull();

    const redirected = await app.inject({ method: "GET", url: "/destold" });
    expect(redirected.statusCode).toBe(302);
    expect(redirected.headers.location).toBe("https://example.com/new");
    expect(JSON.parse((await redisClient().get(redirectCacheKey("destold"))) ?? "null")).toMatchObject({
      location: "https://example.com/new",
    });
  });

  it("stops redirecting after the link is disabled and restores it when enabled", async () => {
    const owner = await createUser("status@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/status",
      customAlias: "status1",
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/status1" })).statusCode).toBe(302);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { status: "disabled" },
    });
    expect(disabled.statusCode).toBe(200);
    const hidden = await app.inject({ method: "GET", url: "/status1" });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.headers.location).toBeUndefined();
    expect(await redisClient().get(redirectCacheKey("status1"))).toBeNull();

    const enabled = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { status: "active" },
    });
    expect(enabled.statusCode).toBe(200);
    const restored = await app.inject({ method: "GET", url: "/status1" });
    expect(restored.statusCode).toBe(302);
    expect(restored.headers.location).toBe("https://example.com/status");
    expect(await redisClient().get(redirectCacheKey("status1"))).not.toBeNull();
  });

  it("stops redirecting after the link is deleted", async () => {
    const owner = await createUser("delete@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/delete",
      customAlias: "delete1",
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/delete1" })).statusCode).toBe(302);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
    });
    expect(deleted.statusCode).toBe(204);
    const missing = await app.inject({ method: "GET", url: "/delete1" });
    expect(missing.statusCode).toBe(404);
    expect(await redisClient().get(redirectCacheKey("delete1"))).toBeNull();
  });

  it("invalidates the old and new alias when the short code changes", async () => {
    const owner = await createUser("alias@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/alias",
      customAlias: "old-name",
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/old-name" })).statusCode).toBe(302);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { customAlias: "new-name" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(await redisClient().get(redirectCacheKey("old-name"))).toBeNull();
    expect(await redisClient().get(redirectCacheKey("new-name"))).toBeNull();

    const oldCode = await app.inject({ method: "GET", url: "/old-name" });
    const newCode = await app.inject({ method: "GET", url: "/new-name" });
    expect(oldCode.statusCode).toBe(404);
    expect(newCode.statusCode).toBe(302);
    expect(newCode.headers.location).toBe("https://example.com/alias");
    expect(JSON.parse((await redisClient().get(redirectCacheKey("new-name"))) ?? "null")).toMatchObject({
      location: "https://example.com/alias",
    });
  });

  it("does not keep a cached redirect past a shortened expiresAt", async () => {
    const owner = await createUser("expiry@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/expires",
      customAlias: "expsoon",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/expsoon" })).statusCode).toBe(302);
    expect(await redisClient().ttl(redirectCacheKey("expsoon"))).toBeGreaterThan(40);

    const shortened = new Date(Date.now() + 15_000).toISOString();
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { expiresAt: shortened },
    });
    expect(updated.statusCode).toBe(200);
    expect(await redisClient().get(redirectCacheKey("expsoon"))).toBeNull();

    const redirected = await app.inject({ method: "GET", url: "/expsoon" });
    expect(redirected.statusCode).toBe(302);
    expect(redirected.headers.location).toBe("https://example.com/expires");
    const ttl = await redisClient().ttl(redirectCacheKey("expsoon"));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15);
  });

  it("falls back to MongoDB when a cache read or write fails", async () => {
    await insertLink({ shortCode: "readfail", originalUrl: "https://example.com/read" });
    await insertLink({ shortCode: "writefl", originalUrl: "https://example.com/write" });
    const redis = redisClient();
    const getSpy = jest.spyOn(redis, "get").mockRejectedValueOnce(new Error("read failed"));

    try {
      const read = await app.inject({ method: "GET", url: "/readfail" });
      expect(read.statusCode).toBe(302);
      expect(read.headers.location).toBe("https://example.com/read");
      expect(JSON.parse((await redis.get(redirectCacheKey("readfail"))) ?? "null")).toMatchObject({
        location: "https://example.com/read",
      });
    } finally {
      getSpy.mockRestore();
    }

    const setSpy = jest.spyOn(redis, "set").mockRejectedValueOnce(new Error("write failed"));
    try {
      const write = await app.inject({ method: "GET", url: "/writefl" });
      expect(write.statusCode).toBe(302);
      expect(write.headers.location).toBe("https://example.com/write");
      expect(await redis.get(redirectCacheKey("writefl"))).toBeNull();
    } finally {
      setSpy.mockRestore();
    }
  });

  it("still redirects when Redis is down and refuses redirect mutations", async () => {
    const owner = await createUser("outage@example.com");
    const other = await createUser("other-outage@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/outage",
      customAlias: "outage1",
    });
    const link = created.json() as Link;
    expect((await app.inject({ method: "GET", url: "/outage1" })).statusCode).toBe(302);

    await disconnectRedis();
    try {
      const redirected = await app.inject({ method: "GET", url: "/outage1" });
      expect(redirected.statusCode).toBe(302);
      expect(redirected.headers.location).toBe("https://example.com/outage");

      const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({ checks: { mongodb: "up", redis: "down" } });

      const blocked = await app.inject({
        method: "PATCH",
        url: `/api/links/${link.id}`,
        headers: authHeader(owner.token),
        payload: { originalUrl: "https://example.com/blocked" },
      });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json()).toMatchObject({ error: REDIRECT_CACHE_UNAVAILABLE });
      expect((await LinkModel.findById(link.id))?.originalUrl).toBe("https://example.com/outage");

      const foreign = await app.inject({
        method: "PATCH",
        url: `/api/links/${link.id}`,
        headers: authHeader(other.token),
        payload: { originalUrl: "https://example.com/blocked" },
      });
      expect(foreign.statusCode).toBe(404);

      const blockedDelete = await app.inject({
        method: "DELETE",
        url: `/api/links/${link.id}`,
        headers: authHeader(owner.token),
      });
      expect(blockedDelete.statusCode).toBe(503);
      expect(await LinkModel.countDocuments({ _id: link.id })).toBe(1);

      const createdDuringOutage = await postLink(owner.token, {
        originalUrl: "https://example.com/created",
        customAlias: "newcode",
      });
      expect(createdDuringOutage.statusCode).toBe(503);
      expect(createdDuringOutage.json()).toMatchObject({ error: RATE_LIMIT_UNAVAILABLE });
      expect(await LinkModel.countDocuments({ shortCode: "newcode" })).toBe(0);
      const missingCode = await app.inject({ method: "GET", url: "/newcode" });
      expect(missingCode.statusCode).toBe(404);
    } finally {
      await connectRedis(redisUrl);
    }
  });

  it("serves a cached redirect when MongoDB is down and fails a cache miss safely", async () => {
    const owner = await createUser("mongo-down@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/cached-while-down",
      customAlias: "cached1",
    });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/cached1" })).headers.location).toBe(
      "https://example.com/cached-while-down",
    );

    await disconnectMongo();
    try {
      const hit = await app.inject({ method: "GET", url: "/cached1" });
      expect(hit.statusCode).toBe(302);
      expect(hit.headers.location).toBe("https://example.com/cached-while-down");

      const miss = await app.inject({ method: "GET", url: "/notcached" });
      expect(miss.statusCode).toBe(500);
      const body = JSON.stringify(miss.json());
      expect(body).toContain("Internal Server Error");
      expect(body).not.toMatch(/Mongo|mongoose|ECONNREFUSED|stack/i);

      const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ status: "unavailable", checks: { mongodb: "down", redis: "up" } });

      const live = await app.inject({ method: "GET", url: "/api/health/live" });
      expect(live.statusCode).toBe(200);
    } finally {
      await connectMongo(mongoUri);
      await ensureLinkIndexes();
    }
  });

  it("leaves API routes outside the short-code matcher while Redis is up", async () => {
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    const links = await app.inject({ method: "GET", url: "/api/links" });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ checks: { mongodb: "up", redis: "up" } });
    expect(login.statusCode).toBe(400);
    expect(links.statusCode).toBe(401);
  });
});
