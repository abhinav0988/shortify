export type LinkStatus = "active" | "disabled";

export interface Link {
  id: string;
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  customAlias: boolean;
  status: LinkStatus;
  expiresAt: string | null;
  totalClicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface LinkListQuery {
  page: number;
  limit: number;
  status?: LinkStatus;
  search?: string;
  sort: "createdAt:asc" | "createdAt:desc";
}

export interface LinkListResponse {
  links: Link[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateLinkRequest {
  originalUrl: string;
  customAlias?: string;
  expiresAt?: string;
}

export interface UpdateLinkRequest {
  originalUrl?: string;
  customAlias?: string;
  status?: LinkStatus;
  expiresAt?: string | null;
}
