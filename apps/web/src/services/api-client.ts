import { apiBaseUrl } from "../config";
import { clearSession, getToken } from "./session";

export interface FieldDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: FieldDetail[];
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, details: FieldDetail[] = [], retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const token = options.token === undefined ? getToken() : options.token;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, "Unable to reach the API. Check that it is running.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    if (response.status === 401 && token) {
      clearSession();
    }
    throw new ApiError(
      response.status,
      payload.error ?? "Request failed",
      payload.details,
      response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : null,
    );
  }

  return payload.raw as T;
}

async function readPayload(response: Response): Promise<{ error?: string; details: FieldDetail[]; raw: unknown }> {
  const text = await response.text();
  if (!text) {
    return { details: [], raw: undefined };
  }

  try {
    const raw = JSON.parse(text) as { error?: unknown; details?: unknown };
    return {
      error: typeof raw.error === "string" ? raw.error : undefined,
      details: Array.isArray(raw.details) ? raw.details.filter(isFieldDetail) : [],
      raw,
    };
  } catch {
    return { details: [], raw: undefined };
  }
}

function isFieldDetail(value: unknown): value is FieldDetail {
  if (!value || typeof value !== "object") {
    return false;
  }
  const detail = value as { path?: unknown; message?: unknown };
  return typeof detail.path === "string" && typeof detail.message === "string";
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.ceil(seconds);
}
