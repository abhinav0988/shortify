export const SERVICE_NAME = "shortify";

export type DependencyStatus = "up" | "down";

export interface LiveHealthResponse {
  status: "ok";
  service: typeof SERVICE_NAME;
}

export interface ReadyHealthResponse {
  status: "ok" | "unavailable";
  service: typeof SERVICE_NAME;
  checks: {
    mongodb: DependencyStatus;
    redis: DependencyStatus;
  };
}
