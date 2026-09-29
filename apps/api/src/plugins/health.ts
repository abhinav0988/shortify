import type { FastifyInstance } from "fastify";
import { SERVICE_NAME, type LiveHealthResponse, type ReadyHealthResponse } from "@shortify/shared";
import { pingRedis } from "../cache/redis.js";
import { pingMongo } from "../database/mongoose.js";

export async function healthPlugin(app: FastifyInstance): Promise<void> {
  app.get("/api/health/live", async (): Promise<LiveHealthResponse> => {
    return {
      status: "ok",
      service: SERVICE_NAME,
    };
  });

  app.get("/api/health/ready", async (_request, reply) => {
    const [mongodbUp, redisUp] = await Promise.all([pingMongo(), pingRedis()]);
    const body: ReadyHealthResponse = {
      status: mongodbUp ? "ok" : "unavailable",
      service: SERVICE_NAME,
      checks: {
        mongodb: mongodbUp ? "up" : "down",
        redis: redisUp ? "up" : "down",
      },
    };

    if (!mongodbUp) {
      return reply.code(503).send(body);
    }

    return body;
  });
}
