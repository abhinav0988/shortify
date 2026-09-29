import type { DashboardStatsResponse, LinkAnalyticsResponse } from "@shortify/shared";
import type { FastifyRequest } from "fastify";
import type { Env } from "../../config/env.js";
import { requireUserId } from "../../plugins/authenticate.js";
import { parseBody } from "../../utils/validation.js";
import { linkAnalyticsQuerySchema } from "./analytics.schema.js";
import { getDashboardStats, getLinkAnalytics } from "./analytics.service.js";

type AnalyticsControllerEnv = Pick<Env, "PUBLIC_BASE_URL">;

export function linkAnalyticsController() {
  return async function linkAnalytics(request: FastifyRequest<{ Params: { id: string } }>): Promise<LinkAnalyticsResponse> {
    const query = parseBody(linkAnalyticsQuerySchema, request.query);
    return getLinkAnalytics(requireUserId(request.user.sub), request.params.id, query.range ?? "30d");
  };
}

export function dashboardStatsController(env: AnalyticsControllerEnv) {
  return async function dashboardStats(request: FastifyRequest): Promise<DashboardStatsResponse> {
    return getDashboardStats(requireUserId(request.user.sub), env.PUBLIC_BASE_URL);
  };
}
