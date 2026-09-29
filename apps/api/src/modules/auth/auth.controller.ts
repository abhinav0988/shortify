import type { AuthResponse, CurrentUserResponse } from "@shortify/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { consumeRateLimit, hashClientAddress } from "../../cache/rate-limit.js";
import type { Env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import { parseBody } from "../../utils/validation.js";
import { loginBodySchema, registerBodySchema } from "./auth.schema.js";
import { findAuthUserById, loginUser, registerUser } from "./auth.service.js";

type AuthControllerEnv = Pick<
  Env,
  | "JWT_SECRET"
  | "AUTH_REGISTER_RATE_LIMIT"
  | "AUTH_REGISTER_RATE_WINDOW_SECONDS"
  | "AUTH_LOGIN_RATE_LIMIT"
  | "AUTH_LOGIN_RATE_WINDOW_SECONDS"
>;

export function registerController(env: AuthControllerEnv) {
  return async function register(request: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> {
    const body = parseBody(registerBodySchema, request.body);
    await consumeRateLimit({
      scope: "register",
      identity: hashClientAddress(clientAddress(request.ip), env.JWT_SECRET),
      limit: env.AUTH_REGISTER_RATE_LIMIT,
      windowSeconds: env.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    });
    const user = await registerUser(body);
    const token = await reply.jwtSign({ sub: user.id });
    const response: AuthResponse = { user, token };
    return reply.code(201).send(response);
  };
}

export function loginController(env: AuthControllerEnv) {
  return async function login(request: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> {
    const body = parseBody(loginBodySchema, request.body);
    await consumeRateLimit({
      scope: "login",
      identity: hashClientAddress(clientAddress(request.ip), env.JWT_SECRET),
      limit: env.AUTH_LOGIN_RATE_LIMIT,
      windowSeconds: env.AUTH_LOGIN_RATE_WINDOW_SECONDS,
    });
    const user = await loginUser(body);
    const token = await reply.jwtSign({ sub: user.id });
    const response: AuthResponse = { user, token };
    return reply.code(200).send(response);
  };
}

export async function currentUserController(request: FastifyRequest): Promise<CurrentUserResponse> {
  const user = await findAuthUserById(request.user.sub);
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }
  return { user };
}

function clientAddress(ip: string): string {
  return ip.length > 0 ? ip : "unknown";
}
