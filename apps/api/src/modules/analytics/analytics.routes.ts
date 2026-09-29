import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { authenticate } from "../../plugins/authenticate.js";
import { dashboardStatsController, linkAnalyticsController } from "./analytics.controller.js";

export function createAnalyticsRoutes(
  env: Pick<Env, "PUBLIC_BASE_URL">,
): (app: FastifyInstance) => Promise<void> {
  return async function analyticsRoutes(app: FastifyInstance): Promise<void> {
    app.addHook("preHandler", authenticate);

    app.get("/api/links/:id/analytics", linkAnalyticsController());
    app.get("/api/dashboard/stats", dashboardStatsController(env));
  };
}