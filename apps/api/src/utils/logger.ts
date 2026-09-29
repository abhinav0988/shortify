import type { FastifyServerOptions } from "fastify";
import type { Env } from "../config/env.js";

export function buildLoggerOptions(env: Env): Exclude<FastifyServerOptions["logger"], boolean | undefined> {
  return {
    level: env.LOG_LEVEL,
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.passwordHash",
      "password",
      "passwordHash",
      "JWT_SECRET",
      "ANALYTICS_IP_SALT",
      "MONGODB_URI",
      "REDIS_URL",
    ],
    serializers: {
      req(request) {
        const url = typeof request.url === "string" ? request.url : "";
        return {
          method: request.method,
          url: url.length > 512 ? `${url.slice(0, 512)}…` : url,
        };
      },
    },
  };
}
