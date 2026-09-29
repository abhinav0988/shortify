import { randomUUID } from "node:crypto";
import { SERVICE_NAME } from "@shortify/shared";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import "./types/jwt.js";
import { setRateLimitLogger, TooManyRequestsError } from "./cache/rate-limit.js";
import { setRedirectCacheLogger } from "./cache/redirect-cache.js";
import type { Env } from "./config/env.js";
import { setAnalyticsLogger } from "./modules/analytics/record-click.js";
import { createAnalyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { createAuthRoutes } from "./modules/auth/auth.routes.js";
import { createLinkRoutes } from "./modules/links/link.routes.js";
import { createRedirectRoutes } from "./modules/redirects/redirect.routes.js";
import { healthPlugin } from "./plugins/health.js";
import { jwtPlugin } from "./plugins/jwt.js";
import { buildLoggerOptions } from "./utils/logger.js";
import { HttpError, ValidationError } from "./utils/http-error.js";

export interface BuildAppOptions {
  env: Env;
  logger?: FastifyServerOptions["logger"];
}

/** Shortify bodies are a URL, an alias, and a few auth fields. 32 KiB is enough and rejects large payloads. */
export const REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === undefined ? buildLoggerOptions(options.env) : options.logger,
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    requestIdHeader: "x-request-id",
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      if (typeof incoming === "string" && incoming.length > 0 && incoming.length <= 128) {
        return incoming;
      }
      return randomUUID();
    },
  });

  await app.register(helmet, {
    // The dashboard is a different origin from the API. same-origin CORP would
    // stop the browser from reading JSON. The SPA sets its own document policy.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    // An array is an allow-list. A string would send that origin on every response.
    origin: [options.env.CORS_ORIGIN],
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
  });

  setRedirectCacheLogger(({ operation, shortCode, err }) => {
    app.log.warn({ operation, shortCode, err }, "redirect cache failure");
  });
  setRateLimitLogger(({ scope, err }) => {
    app.log.warn({ scope, err }, "rate limit check failed");
  });
  setAnalyticsLogger(({ operation, linkId, err }) => {
    app.log.warn({ operation, linkId, err }, "redirect analytics failed");
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (error instanceof TooManyRequestsError) {
      request.log.info({ statusCode: 429 }, "rate limit exceeded");
      return reply.code(429).header("Retry-After", String(error.retryAfterSeconds)).send({
        error: error.message,
        requestId: request.id,
      });
    }

    if (statusCode === 503) {
      request.log.warn({ err: error }, "service unavailable");
      const message = error instanceof HttpError ? error.message : "Service Unavailable";
      return reply.code(503).send({
        error: message,
        requestId: request.id,
      });
    }

    if (isCastError(error)) {
      request.log.info({ statusCode: 400 }, "invalid identifier");
      return reply.code(400).send({
        error: "Invalid identifier",
        requestId: request.id,
      });
    }

    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    } else {
      request.log.info({ statusCode }, "request rejected");
    }

    if (error instanceof ValidationError) {
      return reply.code(400).send({
        error: "Validation failed",
        details: error.details,
        requestId: request.id,
      });
    }

    const message = clientErrorMessage(error, statusCode);
    return reply.code(statusCode).send({
      error: message,
      requestId: request.id,
    });
  });

  await jwtPlugin(app, {
    jwtSecret: options.env.JWT_SECRET,
    jwtExpiresIn: options.env.JWT_EXPIRES_IN,
  });
  await app.register(createAuthRoutes(options.env));
  await app.register(createLinkRoutes(options.env));
  await app.register(createAnalyticsRoutes(options.env));

  await app.register(healthPlugin);

  app.get("/", async () => {
    return {
      name: SERVICE_NAME,
      status: "ok",
    };
  });

  await app.register(createRedirectRoutes(options.env));

  return app;
}

function isCastError(error: FastifyError): boolean {
  return error.name === "CastError";
}

function clientErrorMessage(error: FastifyError, statusCode: number): string {
  if (statusCode >= 500) {
    return "Internal Server Error";
  }
  if (statusCode === 413) {
    return "Request body is too large";
  }
  if (error.message.includes("\n") || error.message.length > 300) {
    return "Request failed";
  }
  return error.message;
}
