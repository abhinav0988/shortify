import type { AnalyticsRange, DashboardStatsResponse, LinkAnalyticsResponse } from "@shortify/shared";
import { apiRequest } from "./api-client";

export function fetchDashboard(): Promise<DashboardStatsResponse> {
  return apiRequest<DashboardStatsResponse>("/api/dashboard/stats");
}

export function fetchLinkAnalytics(id: string, range: AnalyticsRange): Promise<LinkAnalyticsResponse> {
  return apiRequest<LinkAnalyticsResponse>(`/api/links/${encodeURIComponent(id)}/analytics?range=${range}`);
}
