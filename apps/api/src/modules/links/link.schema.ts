import { z } from "zod";
import { isReservedShortCode } from "./short-code.js";

const originalUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .superRefine((value, context) => {
    const message = originalUrlMessage(value);
    if (message) {
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

const customAliasSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/, "Alias must use letters, numbers, and single hyphens")
  .superRefine((value, context) => {
    if (isReservedShortCode(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "This alias is reserved" });
    }
  });

const futureExpirationSchema = z.string().datetime().superRefine((value, context) => {
  if (new Date(value).getTime() <= Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Expiration must be in the future" });
  }
});

export const createLinkBodySchema = z
  .object({
    originalUrl: originalUrlSchema,
    customAlias: customAliasSchema.optional(),
    expiresAt: futureExpirationSchema.optional(),
  })
  .strict();

export const updateLinkBodySchema = z
  .object({
    originalUrl: originalUrlSchema.optional(),
    customAlias: customAliasSchema.optional(),
    status: z.enum(["active", "disabled"]).optional(),
    expiresAt: z.union([futureExpirationSchema, z.null()]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.originalUrl === undefined &&
      value.customAlias === undefined &&
      value.status === undefined &&
      value.expiresAt === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    }
  });

export const listLinksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["active", "disabled"]).optional(),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  sort: z.enum(["createdAt:asc", "createdAt:desc"]).default("createdAt:desc"),
});

export type CreateLinkBody = z.infer<typeof createLinkBodySchema>;
export type UpdateLinkBody = z.infer<typeof updateLinkBodySchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;

function originalUrlMessage(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Must be a valid http or https URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs are allowed";
  }

  if (parsed.hostname.length === 0) {
    return "Must be a valid http or https URL";
  }

  return undefined;
}
