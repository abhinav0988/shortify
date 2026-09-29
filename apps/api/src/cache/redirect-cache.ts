import { z } from "zod";
import { getRedis, pingRedis } from "./redis.js";
import { HttpError } from "../utils/http-error.js";

const REDIRECT_CACHE_KEY_PREFIX = "shortify:redirect:";
const FAILURE_LOG_INTERVAL_MS = 10_000;

export const REDIRECT_CACHE_UNAVAILABLE = "Cache is temporarily unavailable";

const cachedRedirectSchema = z
  .object({
    v: z.literal(2),
    linkId: z.string().regex(/^[a-f\d]{24}$/i),
    location: z.string().min(1).max(2048),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();

export type CachedRedirect = z.infer<typeof cachedRedirectSchema>;

type CacheOperation = "read" | "write" | "invalidate";

type RedirectCacheLogger = (fields: { operation: CacheOperation; shortCode: string; err: Error }) => void;

let logCacheFailureMessage: RedirectCacheLogger = ({ operation, shortCode, err }) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "redirect cache failure",
      operation,
      shortCode,
      err: err.message,
    }),
  );
};

const lastFailureLogAt = new Map<CacheOperation, number>();

export function setRedirectCacheLogger(logger: RedirectCacheLogger): void {
  logCacheFailureMessage = logger;
}

export function redirectCacheKey(shortCode: string): string {
  return `${REDIRECT_CACHE_KEY_PREFIX}${shortCode}`;
}

export function redirectCacheTtlSeconds(expiresAt: Date | null, now: Date, maxTtlSeconds: number): number {
  if (!Number.isInteger(maxTtlSeconds) || maxTtlSeconds <= 0) {
    return 0;
  }
  if (expiresAt === null) {
    return maxTtlSeconds;
  }

  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return 0;
  }

  const remainingSeconds = Math.floor(remainingMs / 1000);
  if (remainingSeconds <= 0) {
    return 0;
  }

  return Math.min(maxTtlSeconds, remainingSeconds);
}

export function parseCachedRedirect(raw: string): CachedRedirect | null {
  try {
    const parsed = cachedRedirectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || !isRedirectHttpUrl(parsed.data.location)) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function isRedirectHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isCachedRedirectCurrent(entry: CachedRedirect, now: Date): boolean {
  if (!isRedirectHttpUrl(entry.location)) {
    return false;
  }
  if (entry.expiresAt === null) {
    return true;
  }

  const expiresAt = new Date(entry.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

export async function getCachedRedirect(shortCode: string): Promise<CachedRedirect | null> {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  const key = redirectCacheKey(shortCode);
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch (error) {
    logCacheFailure("read", shortCode, error);
    return null;
  }

  if (raw === null) {
    return null;
  }

  const parsed = parseCachedRedirect(raw);
  if (!parsed) {
    logCacheFailure("read", shortCode, new Error("malformed redirect cache entry"));
    try {
      await redis.del(key);
    } catch (error) {
      logCacheFailure("invalidate", shortCode, error);
    }
    return null;
  }

  return parsed;
}

export async function setCachedRedirect(shortCode: string, entry: CachedRedirect, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) {
    return;
  }

  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.set(redirectCacheKey(shortCode), JSON.stringify(entry), "EX", ttlSeconds);
  } catch (error) {
    logCacheFailure("write", shortCode, error);
  }
}

export async function invalidateCachedRedirects(shortCodes: string[]): Promise<boolean> {
  const unique = [...new Set(shortCodes.filter((shortCode) => shortCode.length > 0))];
  if (unique.length === 0) {
    return true;
  }

  const redis = getRedis();
  if (!redis) {
    logCacheFailure("invalidate", unique.join(","), new Error("redis client unavailable"));
    return false;
  }

  try {
    await redis.del(...unique.map((shortCode) => redirectCacheKey(shortCode)));
    return true;
  } catch (error) {
    logCacheFailure("invalidate", unique.join(","), error);
    return false;
  }
}

export async function requireRedirectCache(): Promise<void> {
  const available = await pingRedis();
  if (!available) {
    throw new HttpError(503, REDIRECT_CACHE_UNAVAILABLE);
  }
}

function logCacheFailure(operation: CacheOperation, shortCode: string, error: unknown): void {
  const now = Date.now();
  const previous = lastFailureLogAt.get(operation) ?? 0;
  if (now - previous < FAILURE_LOG_INTERVAL_MS) {
    return;
  }
  lastFailureLogAt.set(operation, now);

  const err = error instanceof Error ? error : new Error("redirect cache failure");
  logCacheFailureMessage({ operation, shortCode, err });
}
