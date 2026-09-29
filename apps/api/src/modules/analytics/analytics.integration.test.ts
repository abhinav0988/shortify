import type { DashboardStatsResponse, Link, LinkAnalyticsResponse } from "@shortify/shared";
import { jest } from "@jest/globals";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../app.js";
import { connectRedis, disconnectRedis } from "../../cache/redis.js";
import { parseEnv, type Env } from "../../config/env.js";
import { connectMongo, disconnectMongo } from "../../database/mongoose.js";
import { UserModel } from "../auth/user.model.js";
import { ensureLinkIndexes, LinkModel } from "../links/link.model.js";
import { hashClientIp } from "./click-privacy.js";
import { ensureClickIndexes, ClickEventModel } from "./click-event.model.js";

const salt = "test-only-analytics-salt";
const chromeAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36";

let mongo: StartedMongoDBContainer;
let redisContainer: StartedTestContainer | undefined;
let app: FastifyInstance;
let redisUrl = "";

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
    ANALYTICS_IP_SALT: salt,
    JWT_EXPIRES_IN: "1h",
    LINK_CREATE_RATE_LIMIT: "1000",
    LINK_CREATE_RATE_WINDOW_SECONDS: "60",
  });
}

async function createOwner(email: string): Promise<{ id: string; token: string }> {
  const user = await UserModel.create({
    name: "Analytics Owner",
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

beforeAll(async () => {
  [mongo, redisContainer] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  const env = testEnv(`${mongo.getConnectionString()}/shortify?directConnection=true`);
  await connectMongo(env.MONGODB_URI);
  await connectRedis(redisUrl);
  await UserModel.init();
  await ensureLinkIndexes();
  await ensureClickIndexes();
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
  await ClickEventModel.deleteMany({});
  await LinkModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe("click analytics", () => {
  it("records a redirect and shows it in link analytics and the dashboard", async () => {
    const owner = await createOwner("owner@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/api/links",
      headers: authHeader(owner.token),
      remoteAddress: "203.0.113.10",
      payload: { originalUrl: "https://example.com/products/123", customAlias: "analytics1" },
    });
    expect(created.statusCode).toBe(201);
    const link = created.json() as Link;

    const redirected = await app.inject({
      method: "GET",
      url: "/analytics1",
      remoteAddress: "203.0.113.10",
      headers: {
        referer: "https://news.example/story",
        "user-agent": chromeAgent,
      },
    });
    expect(redirected.statusCode).toBe(302);
    expect(redirected.headers.location).toBe("https://example.com/products/123");

    const stored = await LinkModel.findById(link.id);
    const events = await ClickEventModel.find({ linkId: link.id });
    expect(stored?.totalClicks).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      country: null,
      device: "desktop",
      browser: "chrome",
      referrer: "https://news.example/story",
      ipHash: hashClientIp("203.0.113.10", salt),
    });
    expect(JSON.stringify(events[0]?.toObject())).not.toContain("203.0.113.10");

    const analytics = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics`,
      headers: authHeader(owner.token),
    });
    expect(analytics.statusCode).toBe(200);
    const body = analytics.json() as LinkAnalyticsResponse;
    expect(body.range).toBe("30d");
    expect(body.link).toMatchObject({ id: link.id, totalClicks: 1 });
    expect(body.summary.clicks).toBe(1);
    expect(body.devices).toEqual([{ device: "desktop", clicks: 1 }]);
    expect(body.browsers).toEqual([{ browser: "chrome", clicks: 1 }]);
    expect(body.referrers).toEqual([{ referrer: "https://news.example/story", clicks: 1 }]);
    expect(body.clicksByDay).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("ipHash");
    expect(JSON.stringify(body)).not.toContain("203.0.113.10");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard/stats",
      headers: authHeader(owner.token),
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toMatchObject({
      totalLinks: 1,
      activeLinks: 1,
      disabledLinks: 0,
      totalClicks: 1,
      clicksToday: 1,
    });
  });

  it("increments every successful redirect and ignores failed ones", async () => {
    const owner = await createOwner("counts@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "counted",
      originalUrl: "https://example.com/counted",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });
    await LinkModel.create({
      userId: owner.id,
      shortCode: "paused1",
      originalUrl: "https://example.com/paused",
      customAlias: true,
      status: "disabled",
      expiresAt: null,
      totalClicks: 0,
    });
    await LinkModel.create({
      userId: owner.id,
      shortCode: "expired",
      originalUrl: "https://example.com/expired",
      customAlias: true,
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
      totalClicks: 0,
    });
    await LinkModel.create({
      userId: owner.id,
      shortCode: "badurl1",
      originalUrl: "javascript:alert(1)",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });

    expect((await app.inject({ method: "GET", url: "/counted" })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/counted" })).statusCode).toBe(302);
    for (const url of ["/missing1", "/paused1", "/expired", "/badurl1"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    }

    expect((await LinkModel.findOne({ shortCode: "counted" }))?.totalClicks).toBe(2);
    expect(await ClickEventModel.countDocuments()).toBe(2);
    const direct = await ClickEventModel.find({ referrer: null });
    expect(direct).toHaveLength(2);
  });

  it("keeps totalClicks correct across concurrent redirects", async () => {
    const owner = await createOwner("race@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "raceclk",
      originalUrl: "https://example.com/race",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.inject({ method: "GET", url: "/raceclk" })),
    );
    expect(responses.every((response) => response.statusCode === 302)).toBe(true);
    expect((await LinkModel.findOne({ shortCode: "raceclk" }))?.totalClicks).toBe(8);
    expect(await ClickEventModel.countDocuments({ })).toBe(8);
  });

  it("restricts link analytics to the owner and aggregates the selected range", async () => {
    const owner = await createOwner("analytics-owner@example.com");
    const other = await createOwner("analytics-other@example.com");
    const link = await LinkModel.create({
      userId: owner.id,
      shortCode: "ranged1",
      originalUrl: "https://example.com/range",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 3,
    });
    const now = Date.now();
    await ClickEventModel.create([
      click(link._id, now - 2 * 86_400_000, "mobile", "safari", null),
      click(link._id, now - 10 * 86_400_000, "desktop", "firefox", "https://ref.example/a"),
      click(link._id, now - 40 * 86_400_000, "bot", "other", "https://old.example"),
    ]);
    for (let index = 0; index < 11; index += 1) {
      await ClickEventModel.create(click(link._id, now - 86_400_000, "desktop", "chrome", `https://ref.example/${index}`));
    }

    const missingAuth = await app.inject({ method: "GET", url: `/api/links/${link.id}/analytics` });
    const foreign = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics`,
      headers: authHeader(other.token),
    });
    const missing = await app.inject({
      method: "GET",
      url: `/api/links/${new Types.ObjectId().toString()}/analytics`,
      headers: authHeader(owner.token),
    });
    const invalid = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics?range=1d`,
      headers: authHeader(owner.token),
    });
    const week = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics?range=7d`,
      headers: authHeader(owner.token),
    });
    const month = await app.inject({
      method: "GET",
      url: `/api/links/${link.id}/analytics?range=30d`,
      headers: authHeader(owner.token),
    });

    expect(missingAuth.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
    const weekBody = week.json() as LinkAnalyticsResponse;
    const monthBody = month.json() as LinkAnalyticsResponse;
    expect(weekBody.range).toBe("7d");
    expect(weekBody.summary.clicks).toBe(12);
    expect(monthBody.range).toBe("30d");
    expect(monthBody.summary.clicks).toBe(13);
    expect(weekBody.clicksByDay.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))).toBe(true);
    expect(weekBody.devices.map((item) => item.device).sort()).toEqual(["desktop", "mobile"]);
    expect(weekBody.browsers.map((item) => item.browser).sort()).toEqual(["chrome", "safari"]);
    expect(weekBody.referrers).toHaveLength(10);
    expect(weekBody.referrers.some((item) => item.referrer === "direct")).toBe(true);
    expect(JSON.stringify(weekBody)).not.toContain("ipHash");
  });

  it("summarizes only the authenticated user's dashboard", async () => {
    const owner = await createOwner("dash-owner@example.com");
    const other = await createOwner("dash-other@example.com");
    const older = await LinkModel.create(linkDoc(owner.id, "older01", "https://example.com/older", "active", 1));
    const newest = await LinkModel.create(linkDoc(owner.id, "newest1", "https://example.com/new", "disabled", 9));
    await LinkModel.create(linkDoc(owner.id, "middle1", "https://example.com/mid", "active", 4));
    await LinkModel.create(linkDoc(other.id, "secret1", "https://example.com/secret", "active", 50));
    const extraIds = [];
    for (const [code, clicks] of [
      ["extra01", 2],
      ["extra02", 3],
      ["extra03", 0],
    ] as const) {
      const created = await LinkModel.create(linkDoc(owner.id, code, `https://example.com/${code}`, "active", clicks));
      extraIds.push(created._id);
    }

    await LinkModel.collection.updateOne({ _id: older._id }, { $set: { createdAt: new Date("2024-01-01T00:00:00.000Z") } });
    await LinkModel.collection.updateOne({ _id: newest._id }, { $set: { createdAt: new Date("2026-12-01T00:00:00.000Z") } });
    await ClickEventModel.create(click(older._id, Date.now(), "desktop", "chrome", null));
    await ClickEventModel.create(click(older._id, Date.now() - 3 * 86_400_000, "desktop", "chrome", null));
    const foreignLink = await LinkModel.findOne({ shortCode: "secret1" });
    await ClickEventModel.create(click(foreignLink!._id, Date.now(), "mobile", "safari", null));

    const unauthenticated = await app.inject({ method: "GET", url: "/api/dashboard/stats" });
    const stats = await app.inject({
      method: "GET",
      url: "/api/dashboard/stats",
      headers: authHeader(owner.token),
    });
    expect(unauthenticated.statusCode).toBe(401);
    const body = stats.json() as DashboardStatsResponse;
    expect(body).toMatchObject({
      totalLinks: 6,
      activeLinks: 5,
      disabledLinks: 1,
      totalClicks: 19,
      clicksToday: 1,
    });
    expect(body.recentLinks).toHaveLength(5);
    expect(body.recentLinks[0]?.shortCode).toBe("newest1");
    expect(body.recentLinks.some((link) => link.shortCode === "older01")).toBe(false);
    expect(body.topLinks).toHaveLength(5);
    expect(body.topLinks[0]?.shortCode).toBe("newest1");
    expect(body.topLinks.some((link) => link.shortCode === "secret1")).toBe(false);
    expect(body.recentLinks.some((link) => link.shortCode === "secret1")).toBe(false);
    expect(extraIds).toHaveLength(3);
  });

  it("still redirects when analytics writes fail", async () => {
    const owner = await createOwner("failure@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "failclk",
      originalUrl: "https://example.com/fail",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });

    const insert = jest.spyOn(ClickEventModel, "create").mockRejectedValueOnce(new Error("insert failed"));
    try {
      const response = await app.inject({ method: "GET", url: "/failclk" });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://example.com/fail");
      expect(response.body).not.toContain("insert failed");
    } finally {
      insert.mockRestore();
    }
    expect(await ClickEventModel.countDocuments({ })).toBe(0);
    expect((await LinkModel.findOne({ shortCode: "failclk" }))?.totalClicks).toBe(1);

    await LinkModel.updateOne({ shortCode: "failclk" }, { $set: { totalClicks: 0 } });
    const increment = jest.spyOn(LinkModel, "updateOne").mockRejectedValueOnce(new Error("increment failed"));
    try {
      const response = await app.inject({ method: "GET", url: "/failclk" });
      expect(response.statusCode).toBe(302);
      expect(response.body).not.toContain("increment failed");
    } finally {
      increment.mockRestore();
    }
    expect(await ClickEventModel.countDocuments()).toBe(1);
    expect((await LinkModel.findOne({ shortCode: "failclk" }))?.totalClicks).toBe(0);
  });

  it("records analytics when Redis is down and MongoDB can resolve the link", async () => {
    const owner = await createOwner("redis-down@example.com");
    await LinkModel.create({
      userId: owner.id,
      shortCode: "mongogo",
      originalUrl: "https://example.com/mongo",
      customAlias: true,
      status: "active",
      expiresAt: null,
      totalClicks: 0,
    });

    await disconnectRedis();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/mongogo",
        headers: { "user-agent": chromeAgent },
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://example.com/mongo");
      expect((await LinkModel.findOne({ shortCode: "mongogo" }))?.totalClicks).toBe(1);
      expect(await ClickEventModel.countDocuments({ })).toBe(1);
    } finally {
      await connectRedis(redisUrl);
    }
  });
});

function click(
  linkId: Types.ObjectId,
  timestamp: number,
  device: "desktop" | "mobile" | "tablet" | "bot" | "unknown",
  browser: "chrome" | "firefox" | "safari" | "edge" | "other" | "unknown",
  referrer: string | null,
) {
  return {
    linkId,
    timestamp: new Date(timestamp),
    country: null,
    device,
    browser,
    referrer,
    ipHash: hashClientIp("198.51.100.8", salt),
  };
}

function linkDoc(userId: string, shortCode: string, originalUrl: string, status: "active" | "disabled", totalClicks: number) {
  return {
    userId,
    shortCode,
    originalUrl,
    customAlias: true,
    status,
    expiresAt: null,
    totalClicks,
  };
}
