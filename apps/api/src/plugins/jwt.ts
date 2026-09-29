import jwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";

export interface JwtPluginOptions {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export async function jwtPlugin(app: FastifyInstance, options: JwtPluginOptions): Promise<void> {
  await app.register(jwt, {
    secret: options.jwtSecret,
    sign: { expiresIn: options.jwtExpiresIn },
  });
}
