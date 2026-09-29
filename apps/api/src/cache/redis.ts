import { Redis } from "ioredis";

const PING_TIMEOUT_MS = 2000;

let client: Redis | null = null;
let reportRedisErrors = false;
let logRedisError: (error: Error) => void = (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "redis client error",
      err: error.message,
    }),
  );
};

export function setRedisErrorLogger(logger: (error: Error) => void): void {
  logRedisError = logger;
}

export function enableRedisErrorLogging(): void {
  reportRedisErrors = true;
}

export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: PING_TIMEOUT_MS,
    retryStrategy: () => null,
  });

  redis.on("error", (error: Error) => {
    if (!reportRedisErrors) {
      return;
    }
    logRedisError(error);
  });

  return redis;
}

export async function connectRedis(url: string): Promise<Redis> {
  if (client) {
    return client;
  }

  const redis = createRedisClient(url);
  try {
    await redis.connect();
  } catch (error) {
    redis.disconnect();
    throw error;
  }

  client = redis;
  return redis;
}

export function getRedis(): Redis | null {
  return client;
}

export async function pingRedis(): Promise<boolean> {
  if (!client) {
    return false;
  }

  try {
    const result = await withTimeout(client.ping(), PING_TIMEOUT_MS);
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!client) {
    return;
  }

  const current = client;
  client = null;
  try {
    await current.quit();
  } catch {
    current.disconnect();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("redis ping timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
