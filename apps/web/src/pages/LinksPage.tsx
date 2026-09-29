import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert } from "../components/feedback/Alert";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { CreateLinkForm } from "../features/links/CreateLinkForm";
import { LinkSummary } from "../features/links/LinkSummary";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSessionToken } from "../hooks/useSession";
import { listLinks } from "../services/links.api";
import { changeLinksFilters, linksFiltersToSearchParams, parseLinksFilters } from "../utils/links-query";
import { userMessage } from "../utils/user-message";

export function LinksPage() {
  usePageTitle("My Links");
  const token = useSessionToken();
  const [params, setParams] = useSearchParams();
  const filters = parseLinksFilters(params);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");

  useEffect(() => {
    setSearchDraft(filters.search ?? "");
  }, [filters.search]);

  const links = useQuery({
    queryKey: ["links", filters],
    queryFn: () => listLinks(filters),
    enabled: Boolean(token),
  });

  function update(patch: Parameters<typeof changeLinksFilters>[1]): void {
    const next = changeLinksFilters(filters, patch);
    setParams(linksFiltersToSearchParams(next), { replace: true });
  }

  function applySearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    update({ search: searchDraft });
  }

  const filtered = Boolean(filters.search || filters.status);
  const total = links.data?.pagination.total ?? 0;

  return (
    <div className="stack">
      <header className="page-header">
        <h1>My Links</h1>
        <p className="muted">Search, status, and pages are applied by the API.</p>
      </header>
      <CreateLinkForm />
      <form className="filters" onSubmit={applySearch}>
        <label>
          Search
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} name="search" />
        </label>
        <label>
          Status
          <select
            name="status"
            value={filters.status ?? ""}
            onChange={(event) => update({ status: event.target.value === "active" || event.target.value === "disabled" ? event.target.value : null })}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label>
          Sort
          <select
            name="sort"
            value={filters.sort}
            onChange={(event) => update({ sort: event.target.value === "createdAt:asc" ? "createdAt:asc" : "createdAt:desc" })}
          >
            <option value="createdAt:desc">Newest</option>
            <option value="createdAt:asc">Oldest</option>
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>
      {links.isPending ? <LoadingState label="Loading links" /> : null}
      {links.isError ? (
        <Alert>
          {userMessage(links.error)}{" "}
          <Button variant="ghost" onClick={() => void links.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {links.data && total === 0 ? (
        <EmptyState
          title={filtered ? "No links match these filters" : "No links yet"}
          body={filtered ? "Try another search or status." : "Create a short link above."}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchDraft("");
                  update({ search: null, status: null });
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : null}
      {links.data && total > 0 ? (
        <>
          <div className="table-wrap">
            <table className="link-table">
              <thead>
                <tr>
                  <th>Short URL</th>
                  <th>Original URL</th>
                  <th>Clicks</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Expiration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.data.links.map((link) => (
                  <LinkSummary key={link.id} link={link} layout="table" />
                ))}
              </tbody>
            </table>
          </div>
          <div className="link-cards">
            {links.data.links.map((link) => (
              <LinkSummary key={link.id} link={link} layout="card" />
            ))}
          </div>
          <nav className="pager" aria-label="Pagination">
            <Button variant="secondary" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>
              Previous
            </Button>
            <span>
              Page {links.data.pagination.page} of {links.data.pagination.totalPages}
            </span>
            <Button
              variant="secondary"
              disabled={filters.page >= links.data.pagination.totalPages}
              onClick={() => update({ page: filters.page + 1 })}
            >
              Next
            </Button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
