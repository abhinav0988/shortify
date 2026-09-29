import type { CreateLinkRequest, Link, LinkListResponse, UpdateLinkRequest } from "@shortify/shared";
import { linksRequestQuery, type LinksFilters } from "../utils/links-query";
import { apiRequest } from "./api-client";

export function createLink(body: CreateLinkRequest): Promise<Link> {
  return apiRequest<Link>("/api/links", { method: "POST", body });
}

export function listLinks(filters: LinksFilters): Promise<LinkListResponse> {
  return apiRequest<LinkListResponse>(`/api/links?${linksRequestQuery(filters)}`);
}

export function fetchLink(id: string): Promise<Link> {
  return apiRequest<Link>(`/api/links/${encodeURIComponent(id)}`);
}

export function updateLink(id: string, body: UpdateLinkRequest): Promise<Link> {
  return apiRequest<Link>(`/api/links/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteLink(id: string): Promise<void> {
  return apiRequest<void>(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE" });
}
