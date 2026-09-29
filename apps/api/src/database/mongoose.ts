import mongoose from "mongoose";

const PING_TIMEOUT_MS = 2000;

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.disconnect();
}

export async function pingMongo(): Promise<boolean> {
  try {
    const db = mongoose.connection.db;
    if (!db || mongoose.connection.readyState !== 1) {
      return false;
    }
    await withTimeout(db.admin().ping(), PING_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("mongodb ping timed out"));
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
