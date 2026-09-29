import type { Link } from "./links.js";

export type AnalyticsRange = "7d" | "30d" | "90d";

export interface LinkAnalyticsResponse {
  link: {
    id: string;
    shortCode: string;
    originalUrl: string;
    totalClicks: number;
  };
  range: AnalyticsRange;
  summary: {
    clicks: number;
  };
  clicksByDay: Array<{
    date: string;
    clicks: number;
  }>;
  devices: Array<{
    device: string;
    clicks: number;
  }>;
  browsers: Array<{
    browser: string;
    clicks: number;
  }>;
  referrers: Array<{
    referrer: string;
    clicks: number;
  }>;
}

export interface DashboardStatsResponse {
  totalLinks: number;
  activeLinks: number;
  disabledLinks: number;
  totalClicks: number;
  clicksToday: number;
  recentLinks: Link[];
  topLinks: Link[];
}
