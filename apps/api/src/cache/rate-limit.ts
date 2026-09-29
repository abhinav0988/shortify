import { createHmac } from "node:crypto";
import { getRedis } from "./redis.js";
import { HttpError } from "../utils/http-error.js";

const FAILURE_LOG_INTERVAL_MS = 10_000;

export const RATE_LIMIT_UNAVAILABLE = "Service temporarily unavailable";

export type RateLimitScope = "register" | "login" | "link-create";

export class TooManyRequestsError extends HttpError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, "Too many requests");
    this.name = "TooManyRequestsError";
    this.retryAfterSeconds = Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 1;
  }
}

type RateLimitLogger = (fields: { scope: RateLimitScope; err: Error }) => void;

let logRateLimitFailure: RateLimitLogger = ({ scope, err }) => {
  console.error(
    JSON.stringify({
      level: "warn",
      msg: "rate limit check failed",
      scope,
      err: err.message,
    }),
  );
};

const lastFailureLogAt = new Map<RateLimitScope, number>();

const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export function setRateLimitLogger(logger: RateLimitLogger): void {
  logRateLimitFailure = logger;
}

export function hashClientAddress(address: string, secret: string): string {
  return createHmac("sha256", secret).update(address).digest("hex");
}

export function rateLimitWindowId(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds);
}

export function rateLimitKey(scope: RateLimitScope, identity: string, windowId: number): string {
  return `shortify:ratelimit:${scope}:${identity}:${windowId}`;
}

export async function consumeRateLimit(input: {
  scope: RateLimitScope;
  identity: string;
  limit: number;
  windowSeconds: number;
  nowMs?: number;
}): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    failClosed(input.scope, new Error("redis client unavailable"));
  }

  const key = rateLimitKey(
    input.scope,
    input.identity,
    rateLimitWindowId(input.nowMs ?? Date.now(), input.windowSeconds),
  );

  let raw: unknown;
  try {
    raw = await redis.eval(CONSUME_SCRIPT, 1, key, String(input.windowSeconds));
  } catch (error) {
    failClosed(input.scope, error);
  }

  const decision = parseDecision(raw);
  if (!decision) {
    failClosed(input.scope, new Error("unexpected rate limit response"));
  }

  if (decision.count > input.limit) {
    throw new TooManyRequestsError(decision.ttl);
  }
}

function parseDecision(value: unknown): { count: number; ttl: number } | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const count = Number(value[0]);
  const ttl = Number(value[1]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(ttl)) {
    return null;
  }

  return { count, ttl };
}

function failClosed(scope: RateLimitScope, error: unknown): never {
  const now = Date.now();
  const previous = lastFailureLogAt.get(scope) ?? 0;
  if (now - previous >= FAILURE_LOG_INTERVAL_MS) {
    lastFailureLogAt.set(scope, now);
    const err = error instanceof Error ? error : new Error("rate limit check failed");
    logRateLimitFailure({ scope, err });
  }

  throw new HttpError(503, RATE_LIMIT_UNAVAILABLE);
}
