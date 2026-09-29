const TOKEN_KEY = "shortify.accessToken";

// The access token lives in localStorage so the SPA can send it as a bearer token.
// Any script running on this origin can read it. That is weaker than an HttpOnly cookie.
// Refresh-token cookies are a later change; this client does not log the token.

let token = readStoredToken();
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  try {
    const value = localStorage.getItem(TOKEN_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getToken(): string | null {
  return token;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSession(next: string): void {
  token = next;
  try {
    localStorage.setItem(TOKEN_KEY, next);
  } catch {
    // The in-memory token still authenticates this tab if storage is blocked.
  }
  emit();
}

export function clearSession(): void {
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // The in-memory token is already cleared.
  }
  emit();
}
