import {
  getCachedRedirect,
  isCachedRedirectCurrent,
  isRedirectHttpUrl,
  redirectCacheTtlSeconds,
  setCachedRedirect,
  type CachedRedirect,
} from "../../cache/redirect-cache.js";
import { LinkModel } from "../links/link.model.js";

const STORED_SHORT_CODE = /^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;

export interface RedirectTarget {
  linkId: string;
  location: string;
}

export interface ResolveShortCodeOptions {
  now?: Date;
  cacheTtlSeconds: number;
}

interface StoredRedirect {
  linkId: string;
  location: string;
  expiresAt: Date | null;
}

export async function resolveShortCode(shortCode: string, options: ResolveShortCodeOptions): Promise<RedirectTarget | null> {
  if (!isRedirectCandidate(shortCode)) {
    return null;
  }

  const now = options.now ?? new Date();
  const cached = await getCachedRedirect(shortCode);
  if (cached && isCachedRedirectCurrent(cached, now)) {
    return { linkId: cached.linkId, location: cached.location };
  }

  const stored = await findActiveRedirect(shortCode, now);
  if (!stored) {
    return null;
  }

  // Redis TTL is a whole number of seconds. A link with under a second left still
  // redirects, but it is not cached, because the key would outlive expiresAt.
  const ttlSeconds = redirectCacheTtlSeconds(stored.expiresAt, now, options.cacheTtlSeconds);
  if (ttlSeconds > 0) {
    const entry: CachedRedirect = {
      v: 2,
      linkId: stored.linkId,
      location: stored.location,
      expiresAt: stored.expiresAt ? stored.expiresAt.toISOString() : null,
    };
    await setCachedRedirect(shortCode, entry, ttlSeconds);
  }

  return { linkId: stored.linkId, location: stored.location };
}

async function findActiveRedirect(shortCode: string, now: Date): Promise<StoredRedirect | null> {
  const link = await LinkModel.findOne({ shortCode }).select({ originalUrl: 1, status: 1, expiresAt: 1 }).lean();
  if (!link || link.status !== "active" || !isRedirectHttpUrl(link.originalUrl)) {
    return null;
  }

  const expiresAt = link.expiresAt instanceof Date ? link.expiresAt : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  return { linkId: link._id.toString(), location: link.originalUrl, expiresAt };
}

function isRedirectCandidate(shortCode: string): boolean {
  return shortCode.length >= 3 && shortCode.length <= 32 && STORED_SHORT_CODE.test(shortCode);
}
