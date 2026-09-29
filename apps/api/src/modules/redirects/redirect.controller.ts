import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { headerText, recordRedirectClick } from "../analytics/record-click.js";
import { resolveShortCode } from "./redirect.service.js";

type RedirectControllerEnv = Pick<Env, "REDIRECT_CACHE_TTL_SECONDS" | "ANALYTICS_IP_SALT">;

export function redirectController(env: RedirectControllerEnv) {
  return async function redirect(request: FastifyRequest<{ Params: { shortCode: string } }>, reply: FastifyReply) {
    const target = await resolveShortCode(request.params.shortCode, {
      cacheTtlSeconds: env.REDIRECT_CACHE_TTL_SECONDS,
    });
    if (!target) {
      throw new HttpError(404, "Short link not found");
    }

    await recordRedirectClick({
      linkId: target.linkId,
      referrer: headerText(request.headers.referer),
      userAgent: headerText(request.headers["user-agent"]),
      clientIp: request.ip,
      salt: env.ANALYTICS_IP_SALT,
    });

    return reply.code(302).header("Location", target.location).send();
  };
}
