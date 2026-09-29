import { createHash } from "node:crypto";

export function hashClientIp(ip: string, salt: string): string | null {
  const normalized = ip.trim();
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(`${salt}\n${normalized}`).digest("hex");
}
