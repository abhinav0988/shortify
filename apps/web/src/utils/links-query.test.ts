import { describe, expect, it } from "vitest";
import { changeLinksFilters, linksFiltersToSearchParams, linksRequestQuery, parseLinksFilters } from "./links-query";

describe("link list query", () => {
  it("builds a backend query for page, status, and search", () => {
    const filters = parseLinksFilters(new URLSearchParams("page=2&status=active&search=github"));
    expect(filters).toMatchObject({ page: 2, status: "active", search: "github", sort: "createdAt:desc", limit: 10 });
    expect(linksRequestQuery(filters)).toBe("page=2&limit=10&sort=createdAt%3Adesc&status=active&search=github");
    expect(linksFiltersToSearchParams(filters).toString()).toBe("page=2&status=active&search=github");
  });

  it("resets to page 1 when a filter changes", () => {
    const current = parseLinksFilters(new URLSearchParams("page=2&status=active"));
    expect(changeLinksFilters(current, { search: "docs" }).page).toBe(1);
    expect(changeLinksFilters(current, { page: 3 }).page).toBe(3);
    expect(changeLinksFilters(current, { status: null }).status).toBeUndefined();
  });

  it("ignores unsupported status and sort values", () => {
    const filters = parseLinksFilters(new URLSearchParams("status=archived&sort=clicks&page=0"));
    expect(filters.status).toBeUndefined();
    expect(filters.sort).toBe("createdAt:desc");
    expect(filters.page).toBe(1);
  });
});
