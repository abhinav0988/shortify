const RESERVED_ALIASES = new Set(["analytics", "api", "dashboard", "health", "links", "login", "metrics", "register"]);
const ALIAS_PATTERN = /^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Enter your name.";
  }
  if (trimmed.length > 80) {
    return "Name must be 80 characters or fewer.";
  }
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
    return "Enter a valid email address.";
  }
  return undefined;
}

export function validatePassword(value: string, mode: "register" | "login"): string | undefined {
  if (mode === "login") {
    return value.length > 0 ? undefined : "Enter your password.";
  }
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (value.length > 128) {
    return "Password must be 128 characters or fewer.";
  }
  return undefined;
}

export function validateOriginalUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Enter a destination URL.";
  }
  if (trimmed.length > 2048) {
    return "URL must be 2048 characters or fewer.";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only http and https URLs are allowed.";
    }
    if (parsed.hostname.length === 0) {
      return "Must be a valid http or https URL.";
    }
  } catch {
    return "Must be a valid http or https URL.";
  }
  return undefined;
}

export function validateAlias(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length < 3 || trimmed.length > 32) {
    return "Alias must be 3 to 32 characters.";
  }
  if (!ALIAS_PATTERN.test(trimmed)) {
    return "Alias must use letters, numbers, and single hyphens.";
  }
  if (RESERVED_ALIASES.has(trimmed.toLowerCase())) {
    return "This alias is reserved.";
  }
  return undefined;
}

export function validateFutureExpiration(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Enter a valid expiration date.";
  }
  if (date.getTime() <= Date.now()) {
    return "Expiration must be in the future.";
  }
  return undefined;
}
