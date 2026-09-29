import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/feedback/Alert";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { deleteLink } from "../../services/links.api";
import { refreshLinkQueries } from "../../services/query-client";
import { userMessage } from "../../utils/user-message";

export function DeleteLinkButton({ linkId, stayOnPage = false }: { linkId: string; stayOnPage?: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteLink(linkId),
    onSuccess: async () => {
      setOpen(false);
      queryClient.removeQueries({ queryKey: ["link", linkId] });
      await refreshLinkQueries(queryClient, linkId);
      if (!stayOnPage) {
        navigate("/links");
      }
    },
  });

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete
      </Button>
      {open ? (
        <Dialog title="Delete this short link?" onClose={() => setOpen(false)}>
          <p>The short URL will stop working. This cannot be undone.</p>
          {mutation.isError ? <Alert>{userMessage(mutation.error)}</Alert> : null}
          <div className="actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!mutation.isPending) {
                  mutation.mutate();
                }
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Deleting…" : "Delete link"}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
