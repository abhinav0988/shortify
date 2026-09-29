import { useSyncExternalStore } from "react";
import { getToken, subscribeSession } from "../services/session";

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribeSession, getToken, () => null);
}
