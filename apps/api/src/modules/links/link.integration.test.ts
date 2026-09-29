import type { Link, LinkListResponse } from "@shortify/shared";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../app.js";
import { connectRedis, disconnectRedis } from "../../cache/redis.js";
import { parseEnv, type Env } from "../../config/env.js";
import { connectMongo, disconnectMongo } from "../../database/mongoose.js";
import { UserModel } from "../auth/user.model.js";
import { ensureLinkIndexes, LinkModel } from "./link.model.js";
import { createLink } from "./link.service.js";

const publicBaseUrl = "http://localhost:8080";

let container: StartedMongoDBContainer;
let redisContainer: StartedTestContainer | undefined;
let app: FastifyInstance;

function testEnv(mongodbUri: string): Env {
  return parseEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8080",
    MONGODB_URI: mongodbUri,
    REDIS_URL: "redis://127.0.0.1:6399",
    LOG_LEVEL: "silent",
    PUBLIC_BASE_URL: publicBaseUrl,
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

async function createUser(email: string): Promise<{ id: string; token: string }> {
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

function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function setCreatedAt(linkId: string, isoDate: string): Promise<void> {
  await LinkModel.collection.updateOne(
    { _id: new Types.ObjectId(linkId) },
    { $set: { createdAt: new Date(isoDate) } },
  );
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
  [container, redisContainer] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  const env = testEnv(`${container.getConnectionString()}/shortify?directConnection=true`);
  await connectMongo(env.MONGODB_URI);
  await connectRedis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
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
  if (container) {
    await container.stop();
  }
});

beforeEach(async () => {
  await LinkModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe("links", () => {
  it("creates an authenticated Base62 link and preserves the submitted URL", async () => {
    const owner = await createUser("owner@example.com");
    const response = await postLink(owner.token, {
      originalUrl: "https://Example.com/products/123",
    });

    expect(response.statusCode).toBe(201);
    const link = response.json() as Link;
    expect(link.shortCode).toMatch(/^[0-9a-zA-Z]{7}$/);
    expect(link.customAlias).toBe(false);
    expect(link.originalUrl).toBe("https://Example.com/products/123");
    expect(link.shortUrl).toBe(`${publicBaseUrl}/${link.shortCode}`);
    expect(link.status).toBe("active");
    expect(link.expiresAt).toBeNull();
    expect(link.totalClicks).toBe(0);
  });

  it("rejects unauthenticated link creation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/links",
      payload: { originalUrl: "https://example.com" },
    });

    expect(response.statusCode).toBe(401);
    expect(await LinkModel.countDocuments()).toBe(0);
  });

  it("retries a generated short code after a duplicate key and fails when retries are exhausted", async () => {
    const owner = await createUser("collision@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "collide",
      originalUrl: "https://example.com/existing",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });

    const codes = ["collide", "fresh01"];
    const created = await createLink(
      owner.id,
      { originalUrl: "https://example.com/new" },
      publicBaseUrl,
      { generateCode: () => codes.shift() ?? "unused0", maxAttempts: 3 },
    );
    expect(created.shortCode).toBe("fresh01");
    expect(created.customAlias).toBe(false);
    expect(await LinkModel.countDocuments({ shortCode: "collide" })).toBe(1);

    await expect(
      createLink(owner.id, { originalUrl: "https://example.com/again" }, publicBaseUrl, {
        generateCode: () => "collide",
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(await LinkModel.countDocuments({ shortCode: "collide" })).toBe(1);
  });

  it("does not retry a duplicate custom alias", async () => {
    const owner = await createUser("alias@example.com");
    const first = await postLink(owner.token, {
      originalUrl: "https://example.com/one",
      customAlias: "portfolio",
    });
    expect(first.statusCode).toBe(201);
    expect((first.json() as Link).customAlias).toBe(true);

    const duplicate = await postLink(owner.token, {
      originalUrl: "https://example.com/two",
      customAlias: "portfolio",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: "Short code is already in use" });
    expect(await LinkModel.countDocuments({ shortCode: "portfolio" })).toBe(1);
  });

  it("keeps aliases case-sensitive and rejects reserved names in any case", async () => {
    const owner = await createUser("case@example.com");
    const lower = await postLink(owner.token, {
      originalUrl: "https://example.com/lower",
      customAlias: "abc",
    });
    const upper = await postLink(owner.token, {
      originalUrl: "https://example.com/upper",
      customAlias: "AbC",
    });
    expect(lower.statusCode).toBe(201);
    expect(upper.statusCode).toBe(201);

    const hyphen = await postLink(owner.token, {
      originalUrl: "https://example.com/product",
      customAlias: "my-product",
    });
    expect(hyphen.statusCode).toBe(201);

    for (const alias of ["api", "API", "Dashboard", "metrics", "a", "my--alias", "has space"]) {
      const response = await postLink(owner.token, {
        originalUrl: "https://example.com/reserved",
        customAlias: alias,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("rejects unsupported URL schemes and accepts a future expiration", async () => {
    const owner = await createUser("urls@example.com");
    for (const originalUrl of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,hi",
      "file:///tmp/a",
      "notaurl",
      "ftp://example.com",
      "\tftp://example.com",
      "http://",
      "javascript%3Aalert(1)",
    ]) {
      const response = await postLink(owner.token, { originalUrl });
      expect(response.statusCode).toBe(400);
    }

    const padded = await postLink(owner.token, { originalUrl: "  https://example.com/padded  " });
    expect(padded.statusCode).toBe(201);
    expect((padded.json() as Link).originalUrl).toBe("https://example.com/padded");

    const canonicalScheme = await postLink(owner.token, { originalUrl: "https:example.com/scheme" });
    expect(canonicalScheme.statusCode).toBe(201);
    expect((canonicalScheme.json() as Link).originalUrl).toBe("https:example.com/scheme");

    const past = await postLink(owner.token, {
      originalUrl: "https://example.com",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.statusCode).toBe(400);

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/path",
      expiresAt,
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as Link).expiresAt).toBe(expiresAt);
    expect(await LinkModel.countDocuments()).toBe(3);
  });

  it("lists, filters, searches, sorts, and paginates only the caller's links", async () => {
    const owner = await createUser("owner-list@example.com");
    const other = await createUser("other-list@example.com");

    const first = await postLink(owner.token, { originalUrl: "https://example.com/a+b" });
    const second = await postLink(owner.token, { originalUrl: "https://example.com/products/123" });
    const third = await postLink(owner.token, {
      originalUrl: "https://example.com/archive",
      customAlias: "archive",
    });
    await postLink(other.token, { originalUrl: "https://example.com/secret" });

    const thirdLink = third.json() as Link;
    await app.inject({
      method: "PATCH",
      url: `/api/links/${thirdLink.id}`,
      headers: authHeader(owner.token),
      payload: { status: "disabled" },
    });

    await setCreatedAt((first.json() as Link).id, "2024-01-01T00:00:00.000Z");
    await setCreatedAt((second.json() as Link).id, "2024-06-01T00:00:00.000Z");
    await setCreatedAt(thirdLink.id, "2024-03-01T00:00:00.000Z");

    const page = await app.inject({
      method: "GET",
      url: "/api/links?page=1&limit=2&sort=createdAt:asc",
      headers: authHeader(owner.token),
    });
    expect(page.statusCode).toBe(200);
    const pageBody = page.json() as LinkListResponse;
    expect(pageBody.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(pageBody.links.map((link) => link.originalUrl)).toEqual([
      "https://example.com/a+b",
      "https://example.com/archive",
    ]);

    const nextPage = await app.inject({
      method: "GET",
      url: "/api/links?page=2&limit=2&sort=createdAt:desc",
      headers: authHeader(owner.token),
    });
    const nextBody = nextPage.json() as LinkListResponse;
    expect(nextBody.links).toHaveLength(1);
    expect(nextBody.links[0]?.originalUrl).toBe("https://example.com/a+b");

    const active = await app.inject({
      method: "GET",
      url: "/api/links?status=active",
      headers: authHeader(owner.token),
    });
    const activeBody = active.json() as LinkListResponse;
    expect(activeBody.pagination.total).toBe(2);
    expect(activeBody.links.every((link) => link.status === "active")).toBe(true);

    const search = await app.inject({
      method: "GET",
      url: `/api/links?search=${encodeURIComponent("a+b")}`,
      headers: authHeader(owner.token),
    });
    const searchBody = search.json() as LinkListResponse;
    expect(searchBody.links).toHaveLength(1);
    expect(searchBody.links[0]?.originalUrl).toBe("https://example.com/a+b");

    const tooLarge = await app.inject({
      method: "GET",
      url: "/api/links?limit=51",
      headers: authHeader(owner.token),
    });
    expect(tooLarge.statusCode).toBe(400);
  });

  it("reads and updates only the owner's link", async () => {
    const owner = await createUser("owner-get@example.com");
    const other = await createUser("other-get@example.com");
    const created = await postLink(owner.token, {
      originalUrl: "https://example.com/start",
      customAlias: "start",
    });
    const link = created.json() as Link;
    await postLink(other.token, {
      originalUrl: "https://example.com/taken",
      customAlias: "taken",
    });

    const own = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
    });
    expect(own.statusCode).toBe(200);
    expect((own.json() as Link).shortCode).toBe("start");

    const foreign = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}`,
      headers: authHeader(other.token),
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: "Link not found" });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: {
        originalUrl: "https://example.com/updated",
        status: "disabled",
        expiresAt: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      originalUrl: "https://example.com/updated",
      status: "disabled",
      expiresAt: null,
      shortCode: "start",
    });

    const enabled = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { status: "active" },
    });
    expect(enabled.statusCode).toBe(200);
    expect((enabled.json() as Link).status).toBe("active");

    const aliasClash = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { customAlias: "taken" },
    });
    expect(aliasClash.statusCode).toBe(409);

    const immutable = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
      payload: { totalClicks: 9, userId: other.id, createdAt: "2020-01-01T00:00:00.000Z" },
    });
    expect(immutable.statusCode).toBe(400);
    const stored = await LinkModel.findById(link.id);
    expect(stored?.totalClicks).toBe(0);
    expect(stored?.userId.toString()).toBe(owner.id);
    expect(stored?.shortCode).toBe("start");

    const foreignUpdate = await app.inject({
      method: "PATCH",
      url: `/api/links/${link.id}`,
      headers: authHeader(other.token),
      payload: { status: "disabled" },
    });
    expect(foreignUpdate.statusCode).toBe(404);
    expect((await LinkModel.findById(link.id))?.status).toBe("active");
  });

  it("deletes only the owner's link", async () => {
    const owner = await createUser("owner-delete@example.com");
    const other = await createUser("other-delete@example.com");
    const created = await postLink(owner.token, { originalUrl: "https://example.com/delete" });
    const link = created.json() as Link;

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/links/${link.id}`,
      headers: authHeader(other.token),
    });
    expect(foreignDelete.statusCode).toBe(404);
    expect(await LinkModel.countDocuments({ _id: link.id })).toBe(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(await LinkModel.countDocuments({ _id: link.id })).toBe(0);

    const missing = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}`,
      headers: authHeader(owner.token),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("creates the short-code and list indexes", async () => {
    const indexes = await LinkModel.collection.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { shortCode: 1 }, unique: true }),
        expect.objectContaining({ key: { userId: 1, createdAt: -1 } }),
        expect.objectContaining({ key: { userId: 1, status: 1, createdAt: -1 } }),
      ]),
    );
  });
});
