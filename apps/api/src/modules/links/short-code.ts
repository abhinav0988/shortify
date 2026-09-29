import { randomInt } from "node:crypto";

export const SHORT_CODE_LENGTH = 7;
export const MAX_SHORT_CODE_ATTEMPTS = 5;

const BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const RESERVED_SHORT_CODES = new Set([
  "analytics",
  "api",
  "dashboard",
  "health",
  "links",
  "login",
  "metrics",
  "register",
]);

export function generateBase62Code(length = SHORT_CODE_LENGTH): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    const alphabetIndex = randomInt(BASE62_ALPHABET.length);
    code += BASE62_ALPHABET[alphabetIndex];
  }
  return code;
}

export function isReservedShortCode(value: string): boolean {
  return RESERVED_SHORT_CODES.has(value.toLowerCase());
}

export function reservedShortCodes(): readonly string[] {
  return [...RESERVED_SHORT_CODES].sort();
}
