import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { redirectController } from "./redirect.controller.js";

export function createRedirectRoutes(
  env: Pick<Env, "REDIRECT_CACHE_TTL_SECONDS" | "ANALYTICS_IP_SALT">,
): (app: FastifyInstance) => Promise<void> {
  return async function redirectRoutes(app: FastifyInstance): Promise<void> {
    app.get("/:shortCode", redirectController(env));
  };
}
