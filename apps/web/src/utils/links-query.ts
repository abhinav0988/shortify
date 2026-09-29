import type { LinkStatus } from "@shortify/shared";

export const DEFAULT_LINK_LIMIT = 10;

export interface LinksFilters {
  page: number;
  limit: number;
  status?: LinkStatus;
  search?: string;
  sort: "createdAt:asc" | "createdAt:desc";
}

export function defaultLinksFilters(): LinksFilters {
  return { page: 1, limit: DEFAULT_LINK_LIMIT, sort: "createdAt:desc" };
}

export function parseLinksFilters(params: URLSearchParams): LinksFilters {
  const page = positiveInt(params.get("page"), 1);
  const limit = Math.min(50, Math.max(1, positiveInt(params.get("limit"), DEFAULT_LINK_LIMIT)));
  const statusParam = params.get("status");
  const status = statusParam === "active" || statusParam === "disabled" ? statusParam : undefined;
  const searchRaw = params.get("search")?.trim() ?? "";
  const search = searchRaw.length > 0 ? searchRaw.slice(0, 200) : undefined;
  const sortParam = params.get("sort");
  const sort = sortParam === "createdAt:asc" || sortParam === "createdAt:desc" ? sortParam : "createdAt:desc";
  return { page, limit, status, search, sort };
}

export function linksFiltersToSearchParams(filters: LinksFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page > 1) {
    params.set("page", String(filters.page));
  }
  if (filters.limit !== DEFAULT_LINK_LIMIT) {
    params.set("limit", String(filters.limit));
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  if (filters.sort !== "createdAt:desc") {
    params.set("sort", filters.sort);
  }
  return params;
}

export function linksRequestQuery(filters: LinksFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  params.set("sort", filters.sort);
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  return params.toString();
}

type FilterPatch = Partial<Pick<LinksFilters, "page" | "limit" | "sort">> & {
  status?: LinkStatus | null;
  search?: string | null;
};

export function changeLinksFilters(current: LinksFilters, patch: FilterPatch): LinksFilters {
  const next: LinksFilters = { ...current };
  if (patch.page !== undefined) {
    next.page = patch.page;
  }
  if (patch.limit !== undefined) {
    next.limit = patch.limit;
  }
  if (patch.sort !== undefined) {
    next.sort = patch.sort;
  }
  if (patch.status !== undefined) {
    next.status = patch.status ?? undefined;
  }
  if (patch.search !== undefined) {
    const trimmed = patch.search?.trim() ?? "";
    next.search = trimmed.length > 0 ? trimmed : undefined;
  }

  const filtersChanged =
    patch.status !== undefined || patch.search !== undefined || patch.sort !== undefined || patch.limit !== undefined;
  if (filtersChanged && patch.page === undefined) {
    next.page = 1;
  }
  return next;
}

function positiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}
