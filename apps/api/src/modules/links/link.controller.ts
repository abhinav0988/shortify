import type { Link, LinkListResponse } from "@shortify/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { consumeRateLimit } from "../../cache/rate-limit.js";
import type { Env } from "../../config/env.js";
import { requireUserId } from "../../plugins/authenticate.js";
import { parseBody } from "../../utils/validation.js";
import { createLinkBodySchema, listLinksQuerySchema, updateLinkBodySchema } from "./link.schema.js";
import { createLink, deleteLink, getLink, listLinks, updateLink } from "./link.service.js";

type LinkControllerEnv = Pick<Env, "PUBLIC_BASE_URL" | "LINK_CREATE_RATE_LIMIT" | "LINK_CREATE_RATE_WINDOW_SECONDS">;

type IdParams = { id: string };

export function createLinkController(env: LinkControllerEnv) {
  return async function create(request: FastifyRequest, reply: FastifyReply): Promise<Link> {
    const userId = requireUserId(request.user.sub);
    const body = parseBody(createLinkBodySchema, request.body);
    await consumeRateLimit({
      scope: "link-create",
      identity: userId,
      limit: env.LINK_CREATE_RATE_LIMIT,
      windowSeconds: env.LINK_CREATE_RATE_WINDOW_SECONDS,
    });
    const link = await createLink(userId, body, env.PUBLIC_BASE_URL);
    return reply.code(201).send(link);
  };
}

export function listLinksController(env: LinkControllerEnv) {
  return async function list(request: FastifyRequest): Promise<LinkListResponse> {
    const query = parseBody(listLinksQuerySchema, request.query);
    return listLinks(requireUserId(request.user.sub), query, env.PUBLIC_BASE_URL);
  };
}

export function getLinkController(env: LinkControllerEnv) {
  return async function get(request: FastifyRequest<{ Params: IdParams }>): Promise<Link> {
    return getLink(requireUserId(request.user.sub), request.params.id, env.PUBLIC_BASE_URL);
  };
}

export function updateLinkController(env: LinkControllerEnv) {
  return async function update(request: FastifyRequest<{ Params: IdParams }>): Promise<Link> {
    const body = parseBody(updateLinkBodySchema, request.body);
    return updateLink(requireUserId(request.user.sub), request.params.id, body, env.PUBLIC_BASE_URL);
  };
}

export function deleteLinkController() {
  return async function remove(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    await deleteLink(requireUserId(request.user.sub), request.params.id);
    return reply.code(204).send();
  };
}
