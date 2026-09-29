export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class ValidationError extends HttpError {
  readonly details: Array<{ path: string; message: string }>;

  constructor(details: Array<{ path: string; message: string }>) {
    super(400, "Validation failed");
    this.name = "ValidationError";
    this.details = details;
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === 11000 || candidate.cause?.code === 11000;
}
