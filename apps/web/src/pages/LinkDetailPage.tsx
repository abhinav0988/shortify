import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Alert } from "../components/feedback/Alert";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { LoadingState } from "../components/ui/LoadingState";
import { EditLinkForm } from "../features/links/EditLinkForm";
import { LinkSummary } from "../features/links/LinkSummary";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSessionToken } from "../hooks/useSession";
import { fetchLink } from "../services/links.api";
import { userMessage } from "../utils/user-message";

export function LinkDetailPage() {
  const { id = "" } = useParams();
  const token = useSessionToken();
  const link = useQuery({
    queryKey: ["link", id],
    queryFn: () => fetchLink(id),
    enabled: Boolean(token && id),
  });
  usePageTitle(link.data?.shortCode ?? "Link");

  return (
    <div className="stack">
      <header className="page-header">
        <h1>{link.data?.shortCode ?? "Link"}</h1>
      </header>
      {link.isPending ? <LoadingState label="Loading link" /> : null}
      {link.isError ? (
        <Alert>
          {userMessage(link.error)}{" "}
          <Button variant="ghost" onClick={() => void link.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {link.data ? (
        <>
          <Card title="Link details">
            <LinkSummary link={link.data} layout="detail" />
          </Card>
          <EditLinkForm link={link.data} />
        </>
      ) : null}
    </div>
  );
}
