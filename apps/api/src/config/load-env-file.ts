import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function applyEnvFile(path: string): void {
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1).trim());
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFile(): void {
  const candidates = [
    process.env.SHORTIFY_ENV_FILE,
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ].filter((path): path is string => typeof path === "string" && path.length > 0);

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    applyEnvFile(path);
    return;
  }
}
