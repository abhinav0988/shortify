import type { FastifyRequest } from "fastify";
import { HttpError } from "../utils/http-error.js";

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new HttpError(401, "Authentication required");
  }
}

export function requireUserId(userId: string): string {
  if (!/^[a-f\d]{24}$/i.test(userId)) {
    throw new HttpError(401, "Authentication required");
  }
  return userId;
}
