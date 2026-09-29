import { LinkModel } from "../links/link.model.js";
import { hashClientIp } from "./click-privacy.js";
import { ClickEventModel } from "./click-event.model.js";
import { classifyUserAgent } from "./user-agent.js";

const FAILURE_LOG_INTERVAL_MS = 10_000;
const MAX_REFERRER_LENGTH = 2048;

type AnalyticsOperation = "insert" | "increment";

type AnalyticsLogger = (fields: { operation: AnalyticsOperation; linkId: string; err: Error }) => void;

let logAnalyticsFailure: AnalyticsLogger = ({ operation, linkId, err }) => {
  console.error(
    JSON.stringify({
      level: "warn",
      msg: "redirect analytics failed",
      operation,
      linkId,
      err: err.message,
    }),
  );
};

const lastFailureLogAt = new Map<AnalyticsOperation, number>();

export function setAnalyticsLogger(logger: AnalyticsLogger): void {
  logAnalyticsFailure = logger;
}

export interface RedirectClickInput {
  linkId: string;
  referrer: string | null;
  userAgent: string | null;
  clientIp: string;
  salt: string;
  now?: Date;
}

export async function recordRedirectClick(input: RedirectClickInput): Promise<void> {
  const classified = classifyUserAgent(input.userAgent);
  const timestamp = input.now ?? new Date();

  try {
    await ClickEventModel.create({
      linkId: input.linkId,
      timestamp,
      country: null,
      device: classified.device,
      browser: classified.browser,
      referrer: normalizeReferrer(input.referrer),
      ipHash: hashClientIp(input.clientIp, input.salt),
    });
  } catch (error) {
    reportFailure("insert", input.linkId, error);
  }

  try {
    await LinkModel.updateOne({ _id: input.linkId }, { $inc: { totalClicks: 1 } });
  } catch (error) {
    reportFailure("increment", input.linkId, error);
  }
}

export function headerText(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_REFERRER_LENGTH);
}

function normalizeReferrer(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_REFERRER_LENGTH);
}

function reportFailure(operation: AnalyticsOperation, linkId: string, error: unknown): void {
  const now = Date.now();
  const previous = lastFailureLogAt.get(operation) ?? 0;
  if (now - previous < FAILURE_LOG_INTERVAL_MS) {
    return;
  }
  lastFailureLogAt.set(operation, now);
  const err = error instanceof Error ? error : new Error("redirect analytics failed");
  logAnalyticsFailure({ operation, linkId, err });
}
