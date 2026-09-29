import { z } from "zod";

export const linkAnalyticsQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
});

export type LinkAnalyticsQuery = z.infer<typeof linkAnalyticsQuerySchema>;
