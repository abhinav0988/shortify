import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { authenticate } from "../../plugins/authenticate.js";
import {
  createLinkController,
  deleteLinkController,
  getLinkController,
  listLinksController,
  updateLinkController,
} from "./link.controller.js";

export function createLinkRoutes(
  env: Pick<Env, "PUBLIC_BASE_URL" | "LINK_CREATE_RATE_LIMIT" | "LINK_CREATE_RATE_WINDOW_SECONDS">,
): (app: FastifyInstance) => Promise<void> {
  return async function linkRoutes(app: FastifyInstance): Promise<void> {
    app.addHook("preHandler", authenticate);

    app.post("/api/links", createLinkController(env));
    app.get("/api/links", listLinksController(env));
    app.get("/api/links/:id", getLinkController(env));
    app.patch("/api/links/:id", updateLinkController(env));
    app.delete("/api/links/:id", deleteLinkController());
  };
}
