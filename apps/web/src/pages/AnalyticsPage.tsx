import type { AnalyticsRange } from "@shortify/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert } from "../components/feedback/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { BreakdownChart } from "../features/analytics/BreakdownChart";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSessionToken } from "../hooks/useSession";
import { fetchLinkAnalytics } from "../services/analytics.api";
import { capitalize } from "../utils/format";
import { userMessage } from "../utils/user-message";

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d"];

export function AnalyticsPage() {
  const { id = "" } = useParams();
  const token = useSessionToken();
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get("range"));
  const analytics = useQuery({
    queryKey: ["analytics", id, range],
    queryFn: () => fetchLinkAnalytics(id, range),
    enabled: Boolean(token && id),
  });
  usePageTitle("Analytics");

  function selectRange(next: AnalyticsRange): void {
    const updated = new URLSearchParams(params);
    if (next === "30d") {
      updated.delete("range");
    } else {
      updated.set("range", next);
    }
    setParams(updated, { replace: true });
  }

  const data = analytics.data;
  const hasClicks = (data?.summary.clicks ?? 0) > 0;

  return (
    <div className="stack">
      <header className="page-header">
        <h1>Analytics</h1>
        {data ? (
          <p className="muted">
            <Link to={`/links/${data.link.id}`}>{data.link.shortCode}</Link>
            {" · "}
            {data.link.totalClicks} lifetime clicks · {data.summary.clicks} in this range
          </p>
        ) : (
          <p className="muted">Day buckets use UTC. The chart shows only days the API returned.</p>
        )}
      </header>
      <div className="range-switch" role="group" aria-label="Analytics range">
        {RANGES.map((option) => (
          <Button key={option} variant={option === range ? "primary" : "secondary"} onClick={() => selectRange(option)} aria-pressed={option === range}>
            {option}
          </Button>
        ))}
      </div>
      {analytics.isPending ? <LoadingState label="Loading analytics" /> : null}
      {analytics.isError ? (
        <Alert>
          {userMessage(analytics.error)}{" "}
          <Button variant="ghost" onClick={() => void analytics.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {data && !hasClicks ? <EmptyState title="No analytics for this range" body="Clicks appear after a successful redirect." /> : null}
      {data && hasClicks ? (
        <>
          <section className="stats" aria-label="Selected range">
            <article className="stat">
              <h2>Lifetime clicks</h2>
              <p>{data.link.totalClicks}</p>
            </article>
            <article className="stat">
              <h2>Clicks in range</h2>
              <p>{data.summary.clicks}</p>
            </article>
          </section>
          <Card title="Clicks by day">
            <p className="hint">Dates are UTC.</p>
            <BreakdownChart
              items={data.clicksByDay.map((day) => ({ label: day.date, clicks: day.clicks }))}
              emptyLabel="No daily clicks in this range."
            />
          </Card>
          <div className="split">
            <Card title="Devices">
              <BreakdownChart
                items={data.devices.map((item) => ({ label: capitalize(item.device), clicks: item.clicks }))}
                emptyLabel="No device data for this range."
              />
            </Card>
            <Card title="Browsers">
              <BreakdownChart
                items={data.browsers.map((item) => ({ label: capitalize(item.browser), clicks: item.clicks }))}
                emptyLabel="No browser data for this range."
              />
            </Card>
          </div>
          <Card title="Referrers">
            <BreakdownChart
              items={data.referrers.map((item) => ({ label: item.referrer, clicks: item.clicks }))}
              emptyLabel="No referrer data for this range."
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function parseRange(value: string | null): AnalyticsRange {
  if (value === "7d" || value === "30d" || value === "90d") {
    return value;
  }
  return "30d";
}
