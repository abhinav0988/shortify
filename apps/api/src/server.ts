import { connectRedis, disconnectRedis, enableRedisErrorLogging, setRedisErrorLogger } from "./cache/redis.js";
import { loadEnvFile } from "./config/load-env-file.js";
import { parseEnv } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./database/mongoose.js";
import { ensureUserIndexes } from "./modules/auth/user.model.js";
import { ensureClickIndexes } from "./modules/analytics/click-event.model.js";
import { ensureLinkIndexes } from "./modules/links/link.model.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  loadEnvFile();
  const env = parseEnv();
  await connectMongo(env.MONGODB_URI);
  await ensureUserIndexes();
  await ensureLinkIndexes();
  await ensureClickIndexes();

  const app = await buildApp({ env });
  setRedisErrorLogger((error) => {
    app.log.error({ err: error }, "redis client error");
  });

  try {
    await connectRedis(env.REDIS_URL);
    enableRedisErrorLogging();
    app.log.info("redis connected");
  } catch (error) {
    app.log.error({ err: error }, "redis unavailable; continuing without cache");
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await disconnectMongo();
      await disconnectRedis();
    } catch (error) {
      app.log.error({ err: error }, "shutdown failed");
      process.exit(1);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
