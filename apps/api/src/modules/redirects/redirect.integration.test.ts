import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { buildApp } from "../../app.js";
import { parseEnv, type Env } from "../../config/env.js";
import { connectMongo, disconnectMongo } from "../../database/mongoose.js";
import { ensureLinkIndexes, LinkModel } from "../links/link.model.js";

let container: StartedMongoDBContainer;
let app: FastifyInstance;

function testEnv(mongodbUri: string): Env {
  return parseEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8080",
    MONGODB_URI: mongodbUri,
    REDIS_URL: "redis://127.0.0.1:6399",
    LOG_LEVEL: "silent",
    PUBLIC_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:3000",
    JWT_SECRET: "test-only-jwt-secret-value",
    ANALYTICS_IP_SALT: "test-only-analytics-salt",
    JWT_EXPIRES_IN: "1h",
  });
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
    customAlias: false,
    status: input.status ?? "active",
    expiresAt: input.expiresAt ?? null,
    totalClicks: 0,
  });
}

beforeAll(async () => {
  container = await new MongoDBContainer("mongo:7").start();
  const env = testEnv(`${container.getConnectionString()}/shortify?directConnection=true`);
  await connectMongo(env.MONGODB_URI);
  await ensureLinkIndexes();
  app = await buildApp({ env, logger: false });
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  await disconnectMongo();
  if (container) {
    await container.stop();
  }
});

beforeEach(async () => {
  await LinkModel.deleteMany({});
});

describe("redirects", () => {
  it("redirects an active non-expiring link without changing the stored URL", async () => {
    await insertLink({ shortCode: "aB7xK2" });

    const response = await app.inject({
      method: "GET",
      url: "/aB7xK2?tracking=1",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://example.com/products/123?keep=1");
    expect(response.body).not.toContain("originalUrl");
    expect((await LinkModel.findOne({ shortCode: "aB7xK2" }))?.totalClicks).toBe(1);
  });

  it("redirects a link that expires in the future", async () => {
    await insertLink({
      shortCode: "future1",
      originalUrl: "https://example.com/future",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await app.inject({ method: "GET", url: "/future1" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://example.com/future");
  });

  it("does not redirect missing, disabled, or expired links", async () => {
    await insertLink({ shortCode: "paused1", status: "disabled" });
    await insertLink({
      shortCode: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    });

    for (const url of ["/missing1", "/paused1", "/expired", "/zz", "/my--alias"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.headers.location).toBeUndefined();
      expect(response.json()).toMatchObject({ error: "Short link not found" });
    }
  });

  it("treats short codes as case-sensitive", async () => {
    await insertLink({ shortCode: "abc", originalUrl: "https://example.com/lower" });
    await insertLink({ shortCode: "AbC", originalUrl: "https://example.com/mixed" });

    const lower = await app.inject({ method: "GET", url: "/abc" });
    const mixed = await app.inject({ method: "GET", url: "/AbC" });

    expect(lower.statusCode).toBe(302);
    expect(lower.headers.location).toBe("https://example.com/lower");
    expect(mixed.statusCode).toBe(302);
    expect(mixed.headers.location).toBe("https://example.com/mixed");
  });

  it("does not redirect a stored non-http URL", async () => {
    await insertLink({ shortCode: "badurl1", originalUrl: "javascript:alert(1)" });

    const response = await app.inject({ method: "GET", url: "/badurl1" });
    expect(response.statusCode).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });

  it("leaves API routes outside the short-code matcher", async () => {
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    const links = await app.inject({ method: "GET", url: "/api/links" });
    const root = await app.inject({ method: "GET", url: "/" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: "ok" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: "ok",
      checks: { mongodb: "up", redis: "down" },
    });
    expect(login.statusCode).toBe(400);
    expect(login.json()).toMatchObject({ error: "Validation failed" });
    expect(links.statusCode).toBe(401);
    expect(links.json()).toMatchObject({ error: "Authentication required" });
    expect(root.statusCode).toBe(200);
    expect(root.json()).toMatchObject({ name: "shortify" });
  });
});
