import type { Link } from "@shortify/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../../components/feedback/Alert";
import { Button } from "../../components/ui/Button";
import { updateLink } from "../../services/links.api";
import { refreshLinkQueries } from "../../services/query-client";
import { userMessage } from "../../utils/user-message";

export function StatusButton({ link }: { link: Link }) {
  const queryClient = useQueryClient();
  const nextStatus = link.status === "active" ? "disabled" : "active";
  const mutation = useMutation({
    mutationFn: () => updateLink(link.id, { status: nextStatus }),
    onSuccess: async () => {
      await refreshLinkQueries(queryClient, link.id);
    },
  });

  return (
    <span className="status-control">
      <Button
        variant="secondary"
        onClick={() => {
          if (!mutation.isPending) {
            mutation.mutate();
          }
        }}
        disabled={mutation.isPending}
      >
        {link.status === "active" ? "Disable" : "Enable"}
      </Button>
      {mutation.isError ? <Alert>{userMessage(mutation.error)}</Alert> : null}
    </span>
  );
}
