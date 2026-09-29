import type { FastifyInstance } from "fastify";
import type { Env } from "../../config/env.js";
import { authenticate } from "../../plugins/authenticate.js";
import { currentUserController, loginController, registerController } from "./auth.controller.js";

type AuthRouteEnv = Pick<
  Env,
  | "JWT_SECRET"
  | "AUTH_REGISTER_RATE_LIMIT"
  | "AUTH_REGISTER_RATE_WINDOW_SECONDS"
  | "AUTH_LOGIN_RATE_LIMIT"
  | "AUTH_LOGIN_RATE_WINDOW_SECONDS"
>;

export function createAuthRoutes(env: AuthRouteEnv): (app: FastifyInstance) => Promise<void> {
  return async function authRoutes(app: FastifyInstance): Promise<void> {
    app.post("/api/auth/register", registerController(env));
    app.post("/api/auth/login", loginController(env));
    app.get("/api/auth/me", { preHandler: authenticate }, currentUserController);
  };
}
