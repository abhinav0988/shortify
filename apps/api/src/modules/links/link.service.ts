import type { Link as LinkDto, LinkListResponse } from "@shortify/shared";
import { Types, type FilterQuery } from "mongoose";
import { invalidateCachedRedirects, requireRedirectCache } from "../../cache/redirect-cache.js";
import { HttpError, isDuplicateKeyError } from "../../utils/http-error.js";
import type { CreateLinkBody, UpdateLinkBody } from "./link.schema.js";
import { LinkModel, type LinkEntity } from "./link.model.js";
import { generateBase62Code, isReservedShortCode, MAX_SHORT_CODE_ATTEMPTS } from "./short-code.js";

export interface CreateLinkDependencies {
  generateCode?: () => string;
  maxAttempts?: number;
}

export async function createLink(
  userId: string,
  input: CreateLinkBody,
  publicBaseUrl: string,
  dependencies: CreateLinkDependencies = {},
): Promise<LinkDto> {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const ownerId = new Types.ObjectId(userId);

  if (input.customAlias) {
    const link = await insertLink({
      userId: ownerId,
      shortCode: input.customAlias,
      originalUrl: input.originalUrl,
      customAlias: true,
      expiresAt,
      publicBaseUrl,
    });
    if (!link) {
      throw new HttpError(409, "Short code is already in use");
    }
    await invalidateCachedRedirects([link.shortCode]);
    return link;
  }

  const generateCode = dependencies.generateCode ?? generateBase62Code;
  const maxAttempts = dependencies.maxAttempts ?? MAX_SHORT_CODE_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const shortCode = generateCode();
    if (isReservedShortCode(shortCode)) {
      continue;
    }

    const link = await insertLink({
      userId: ownerId,
      shortCode,
      originalUrl: input.originalUrl,
      customAlias: false,
      expiresAt,
      publicBaseUrl,
    });
    if (link) {
      await invalidateCachedRedirects([link.shortCode]);
      return link;
    }
  }

  throw new HttpError(500, "Could not generate a unique short code");
}

export async function listLinks(
  userId: string,
  query: {
    page?: number;
    limit?: number;
    status?: "active" | "disabled";
    search?: string;
    sort?: "createdAt:asc" | "createdAt:desc";
  },
  publicBaseUrl: string,
): Promise<LinkListResponse> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const filter: FilterQuery<LinkEntity> = { userId: new Types.ObjectId(userId) };
  if (query.status) {
    filter.status = query.status;
  }
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ shortCode: pattern }, { originalUrl: pattern }];
  }

  const direction = query.sort === "createdAt:asc" ? 1 : -1;
  const skip = (page - 1) * limit;
  const [links, total] = await Promise.all([
    LinkModel.find(filter)
      .sort({ createdAt: direction, _id: direction })
      .skip(skip)
      .limit(limit),
    LinkModel.countDocuments(filter),
  ]);

  return {
    links: links.map((link) => toPublicLink(link, publicBaseUrl)),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export async function getLink(userId: string, linkId: string, publicBaseUrl: string): Promise<LinkDto> {
  const link = await findOwnedLink(userId, linkId);
  return toPublicLink(link, publicBaseUrl);
}

export async function updateLink(
  userId: string,
  linkId: string,
  input: UpdateLinkBody,
  publicBaseUrl: string,
): Promise<LinkDto> {
  const existing = await findOwnedLink(userId, linkId);
  await requireRedirectCache();
  const update: {
    originalUrl?: string;
    shortCode?: string;
    customAlias?: boolean;
    status?: "active" | "disabled";
    expiresAt?: Date | null;
  } = {};

  if (input.originalUrl !== undefined) {
    update.originalUrl = input.originalUrl;
  }
  if (input.status !== undefined) {
    update.status = input.status;
  }
  if (input.expiresAt !== undefined) {
    update.expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);
  }
  if (input.customAlias !== undefined) {
    update.shortCode = input.customAlias;
    update.customAlias = true;
  }

  try {
    const link = await LinkModel.findOneAndUpdate(
      { _id: existing._id, userId: existing.userId },
      { $set: update },
      { new: true },
    );
    if (!link) {
      throw new HttpError(404, "Link not found");
    }
    await invalidateCachedRedirects([existing.shortCode, link.shortCode]);
    return toPublicLink(link, publicBaseUrl);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isDuplicateKeyError(error)) {
      throw new HttpError(409, "Short code is already in use");
    }
    throw error;
  }
}

export async function deleteLink(userId: string, linkId: string): Promise<void> {
  const existing = await findOwnedLink(userId, linkId);
  await requireRedirectCache();
  const result = await LinkModel.deleteOne({
    _id: existing._id,
    userId: existing.userId,
  });
  if (result.deletedCount !== 1) {
    throw new HttpError(404, "Link not found");
  }
  await invalidateCachedRedirects([existing.shortCode]);
}

async function insertLink(input: {
  userId: Types.ObjectId;
  shortCode: string;
  originalUrl: string;
  customAlias: boolean;
  expiresAt: Date | null;
  publicBaseUrl: string;
}): Promise<LinkDto | null> {
  try {
    const link = await LinkModel.create({
      userId: input.userId,
      shortCode: input.shortCode,
      originalUrl: input.originalUrl,
      customAlias: input.customAlias,
      status: "active",
      expiresAt: input.expiresAt,
      totalClicks: 0,
    });
    return toPublicLink(link, input.publicBaseUrl);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return null;
    }
    throw error;
  }
}

async function findOwnedLink(userId: string, linkId: string): Promise<LinkEntity> {
  const link = await LinkModel.findOne({
    _id: parseLinkId(linkId),
    userId: new Types.ObjectId(userId),
  });
  if (!link) {
    throw new HttpError(404, "Link not found");
  }
  return link;
}

function parseLinkId(linkId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(linkId)) {
    throw new HttpError(404, "Link not found");
  }
  return new Types.ObjectId(linkId);
}

export function toPublicLink(link: Pick<
  LinkEntity,
  | "_id"
  | "shortCode"
  | "originalUrl"
  | "customAlias"
  | "status"
  | "expiresAt"
  | "totalClicks"
  | "createdAt"
  | "updatedAt"
>, publicBaseUrl: string): LinkDto {
  const base = publicBaseUrl.replace(/\/$/, "");
  return {
    id: link._id.toString(),
    shortCode: link.shortCode,
    shortUrl: `${base}/${link.shortCode}`,
    originalUrl: link.originalUrl,
    customAlias: link.customAlias,
    status: link.status,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    totalClicks: link.totalClicks,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
