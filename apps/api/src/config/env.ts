import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PUBLIC_BASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().url(),
  JWT_SECRET: z.string().min(16),
  ANALYTICS_IP_SALT: z.string().min(16),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, "must be a duration such as 15m, 12h, or 7d")
    .default("1d"),
  REDIRECT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(300),
  AUTH_REGISTER_RATE_LIMIT: positiveInt(10_000).default(5),
  AUTH_REGISTER_RATE_WINDOW_SECONDS: positiveInt(86_400).default(60),
  AUTH_LOGIN_RATE_LIMIT: positiveInt(10_000).default(10),
  AUTH_LOGIN_RATE_WINDOW_SECONDS: positiveInt(86_400).default(60),
  LINK_CREATE_RATE_LIMIT: positiveInt(10_000).default(10),
  LINK_CREATE_RATE_WINDOW_SECONDS: positiveInt(86_400).default(60),
});

function positiveInt(max: number) {
  return z.coerce.number().int().positive().max(max);
}

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
