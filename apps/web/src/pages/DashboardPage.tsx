import type { Link } from "@shortify/shared";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { Alert } from "../components/feedback/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { CreateLinkForm } from "../features/links/CreateLinkForm";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSessionToken } from "../hooks/useSession";
import { fetchDashboard } from "../services/analytics.api";
import { userMessage } from "../utils/user-message";

export function DashboardPage() {
  usePageTitle("Dashboard");
  const token = useSessionToken();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    enabled: Boolean(token),
  });

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">Totals come from your links. Today’s clicks use the UTC calendar day.</p>
      </header>
      <CreateLinkForm />
      {dashboard.isPending ? <LoadingState label="Loading dashboard" /> : null}
      {dashboard.isError ? (
        <Alert>
          {userMessage(dashboard.error)}{" "}
          <Button variant="ghost" onClick={() => void dashboard.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {dashboard.data ? (
        <>
          <section className="stats" aria-label="Account totals">
            <Stat label="Total links" value={dashboard.data.totalLinks} />
            <Stat label="Active links" value={dashboard.data.activeLinks} />
            <Stat label="Disabled links" value={dashboard.data.disabledLinks} />
            <Stat label="Total clicks" value={dashboard.data.totalClicks} />
            <Stat label="Clicks today" value={dashboard.data.clicksToday} />
          </section>
          <div className="split">
            <LinkColumn title="Recent links" links={dashboard.data.recentLinks} empty="No links yet. Create one above." />
            <LinkColumn title="Top links" links={dashboard.data.topLinks} empty="Clicks will appear here after someone uses a short URL." />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat">
      <h2>{label}</h2>
      <p>{value}</p>
    </article>
  );
}

function LinkColumn({ title, links, empty }: { title: string; links: Link[]; empty: string }) {
  return (
    <Card title={title}>
      {links.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="plain-list">
          {links.map((link) => (
            <li key={link.id}>
              <RouterLink to={`/links/${link.id}`}>{link.shortCode}</RouterLink>
              <span className="muted">
                {link.totalClicks} clicks · {link.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
