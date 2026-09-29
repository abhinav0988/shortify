import type { AuthResponse, CurrentUserResponse, LoginRequest, RegisterRequest } from "@shortify/shared";
import { apiRequest } from "./api-client";

export function registerAccount(body: RegisterRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/auth/register", { method: "POST", body, token: null });
}

export function loginAccount(body: LoginRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/auth/login", { method: "POST", body, token: null });
}

export function fetchCurrentUser(): Promise<CurrentUserResponse> {
  return apiRequest<CurrentUserResponse>("/api/auth/me");
}
