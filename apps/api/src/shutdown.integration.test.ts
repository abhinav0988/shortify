import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 18081;

let mongo: StartedMongoDBContainer | undefined;
let redis: StartedTestContainer | undefined;
let child: ChildProcess | undefined;

beforeAll(async () => {
  [mongo, redis] = await Promise.all([
    new MongoDBContainer("mongo:7").start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
});

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
  }
  await redis?.stop();
  await mongo?.stop();
});

it("closes the API, MongoDB, and Redis on SIGTERM", async () => {
  if (!mongo || !redis) {
    throw new Error("containers did not start");
  }
  const mongoUri = `${mongo.getConnectionString()}/shortify?directConnection=true`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      MONGODB_URI: mongoUri,
      REDIS_URL: redisUrl,
      LOG_LEVEL: "info",
      PUBLIC_BASE_URL: "http://127.0.0.1:18081",
      CORS_ORIGIN: "http://localhost:3000",
      JWT_SECRET: "test-only-jwt-secret-value",
      ANALYTICS_IP_SALT: "test-only-analytics-salt",
      JWT_EXPIRES_IN: "1h",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.push(chunk.toString());
  });

  try {
    await waitForReady(port);
    child.kill("SIGTERM");
    const code = await waitForExit(child, 15_000);
    expect(code).toBe(0);
  } catch (error) {
    const details = output.join("").slice(-2000);
    throw new Error(`${error instanceof Error ? error.message : "shutdown failed"}\n${details}`);
  }
});

async function waitForReady(listenPort: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${listenPort}/api/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process is still opening MongoDB or the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become ready");
}

function waitForExit(processHandle: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      reject(new Error("shutdown timed out"));
    }, timeoutMs);
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
