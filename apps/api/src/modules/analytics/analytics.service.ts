import type { AnalyticsRange, DashboardStatsResponse, LinkAnalyticsResponse } from "@shortify/shared";
import { Types } from "mongoose";
import { HttpError } from "../../utils/http-error.js";
import { toPublicLink } from "../links/link.service.js";
import { LinkModel, type LinkEntity } from "../links/link.model.js";
import { ClickEventModel } from "./click-event.model.js";

const RANGE_DAYS: Record<AnalyticsRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const TOP_REFERRERS = 10;
const RECENT_LINKS = 5;
const TOP_LINKS = 5;

interface AnalyticsFacet {
  summary: Array<{ clicks: number }>;
  clicksByDay: Array<{ date: string; clicks: number }>;
  devices: Array<{ device: string; clicks: number }>;
  browsers: Array<{ browser: string; clicks: number }>;
  referrers: Array<{ referrer: string; clicks: number }>;
}

export async function getLinkAnalytics(
  userId: string,
  linkId: string,
  range: AnalyticsRange,
  now: Date = new Date(),
): Promise<LinkAnalyticsResponse> {
  const link = await findOwnedLink(userId, linkId);
  const start = new Date(now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  const [facet] = await ClickEventModel.aggregate<AnalyticsFacet>([
    {
      $match: {
        linkId: link._id,
        timestamp: { $gte: start, $lte: now },
      },
    },
    {
      $facet: {
        summary: [{ $count: "clicks" }],
        clicksByDay: [
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: "UTC" } },
              clicks: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: "$_id", clicks: 1 } },
        ],
        devices: [
          { $group: { _id: "$device", clicks: { $sum: 1 } } },
          { $sort: { clicks: -1, _id: 1 } },
          { $project: { _id: 0, device: "$_id", clicks: 1 } },
        ],
        browsers: [
          { $group: { _id: "$browser", clicks: { $sum: 1 } } },
          { $sort: { clicks: -1, _id: 1 } },
          { $project: { _id: 0, browser: "$_id", clicks: 1 } },
        ],
        referrers: [
          {
            $group: {
              _id: {
                $cond: [{ $in: ["$referrer", [null, ""]] }, "direct", "$referrer"],
              },
              clicks: { $sum: 1 },
            },
          },
          { $sort: { clicks: -1, _id: 1 } },
          { $limit: TOP_REFERRERS },
          { $project: { _id: 0, referrer: "$_id", clicks: 1 } },
        ],
      },
    },
  ]);

  return {
    link: {
      id: link._id.toString(),
      shortCode: link.shortCode,
      originalUrl: link.originalUrl,
      totalClicks: link.totalClicks,
    },
    range,
    summary: { clicks: facet?.summary[0]?.clicks ?? 0 },
    clicksByDay: facet?.clicksByDay ?? [],
    devices: facet?.devices ?? [],
    browsers: facet?.browsers ?? [],
    referrers: facet?.referrers ?? [],
  };
}

export async function getDashboardStats(
  userId: string,
  publicBaseUrl: string,
  now: Date = new Date(),
): Promise<DashboardStatsResponse> {
  const ownerId = new Types.ObjectId(userId);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [summary, linkIds, recentLinks, topLinks] = await Promise.all([
    LinkModel.aggregate<{
      totalLinks: number;
      activeLinks: number;
      disabledLinks: number;
      totalClicks: number;
    }>([
      { $match: { userId: ownerId } },
      {
        $group: {
          _id: null,
          totalLinks: { $sum: 1 },
          activeLinks: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          disabledLinks: { $sum: { $cond: [{ $eq: ["$status", "disabled"] }, 1, 0] } },
          totalClicks: { $sum: "$totalClicks" },
        },
      },
    ]),
    LinkModel.distinct("_id", { userId: ownerId }),
    LinkModel.find({ userId: ownerId }).sort({ createdAt: -1, _id: -1 }).limit(RECENT_LINKS),
    LinkModel.find({ userId: ownerId }).sort({ totalClicks: -1, _id: 1 }).limit(TOP_LINKS),
  ]);

  const clicksToday =
    linkIds.length === 0
      ? 0
      : await ClickEventModel.countDocuments({
          linkId: { $in: linkIds },
          timestamp: { $gte: dayStart, $lt: dayEnd },
        });

  const totals = summary[0];
  return {
    totalLinks: totals?.totalLinks ?? 0,
    activeLinks: totals?.activeLinks ?? 0,
    disabledLinks: totals?.disabledLinks ?? 0,
    totalClicks: totals?.totalClicks ?? 0,
    clicksToday,
    recentLinks: recentLinks.map((link) => toPublicLink(link, publicBaseUrl)),
    topLinks: topLinks.map((link) => toPublicLink(link, publicBaseUrl)),
  };
}

async function findOwnedLink(userId: string, linkId: string): Promise<LinkEntity> {
  if (!Types.ObjectId.isValid(linkId)) {
    throw new HttpError(404, "Link not found");
  }

  const link = await LinkModel.findOne({
    _id: new Types.ObjectId(linkId),
    userId: new Types.ObjectId(userId),
  });
  if (!link) {
    throw new HttpError(404, "Link not found");
  }
  return link;
}
