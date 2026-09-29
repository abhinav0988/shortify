import type { Link, UpdateLinkRequest } from "@shortify/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert } from "../../components/feedback/Alert";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { updateLink } from "../../services/links.api";
import { refreshLinkQueries } from "../../services/query-client";
import { fromDatetimeLocal, toDatetimeLocal } from "../../utils/format";
import { userMessage } from "../../utils/user-message";
import { validateAlias, validateFutureExpiration, validateOriginalUrl } from "../../utils/validation";

export function EditLinkForm({ link }: { link: Link }) {
  const queryClient = useQueryClient();
  const [originalUrl, setOriginalUrl] = useState(link.originalUrl);
  const [alias, setAlias] = useState(link.customAlias ? link.shortCode : "");
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocal(link.expiresAt));
  const [fieldErrors, setFieldErrors] = useState<{ originalUrl?: string; alias?: string; expiresAt?: string }>({});
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: UpdateLinkRequest) => updateLink(link.id, body),
    onSuccess: async () => {
      setSaved(true);
      await refreshLinkQueries(queryClient, link.id);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    const nextErrors = {
      originalUrl: validateOriginalUrl(originalUrl),
      alias: validateAlias(alias),
      expiresAt: validateFutureExpiration(expiresAt),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.originalUrl || nextErrors.alias || nextErrors.expiresAt) {
      return;
    }

    const body: UpdateLinkRequest = {};
    if (originalUrl.trim() !== link.originalUrl) {
      body.originalUrl = originalUrl.trim();
    }
    const nextAlias = alias.trim();
    if (nextAlias && nextAlias !== link.shortCode) {
      body.customAlias = nextAlias;
    }
    const nextExpiration = fromDatetimeLocal(expiresAt) ?? null;
    const currentExpiration = link.expiresAt;
    if ((nextExpiration ?? null) !== (currentExpiration ?? null) && expirationChanged(expiresAt, link.expiresAt)) {
      body.expiresAt = expiresAt ? nextExpiration : null;
    }

    if (body.originalUrl === undefined && body.customAlias === undefined && body.expiresAt === undefined) {
      setFieldErrors({ originalUrl: "Change a field before saving." });
      return;
    }

    setSaved(false);
    mutation.mutate(body);
  }

  return (
    <Card title="Edit link">
      <form id="edit" className="stack" onSubmit={submit} noValidate>
        <Field id="edit-original-url" label="Original URL" error={fieldErrors.originalUrl}>
          <input
            id="edit-original-url"
            name="originalUrl"
            type="url"
            value={originalUrl}
            aria-invalid={Boolean(fieldErrors.originalUrl)}
            aria-describedby={fieldErrors.originalUrl ? "edit-original-url-error" : undefined}
            onChange={(event) => setOriginalUrl(event.target.value)}
            required
          />
        </Field>
        <Field id="edit-alias" label="Custom alias" hint="Leave unchanged to keep the current short code." error={fieldErrors.alias}>
          <input
            id="edit-alias"
            name="customAlias"
            value={alias}
            aria-invalid={Boolean(fieldErrors.alias)}
            aria-describedby={fieldErrors.alias ? "edit-alias-error" : "edit-alias-hint"}
            onChange={(event) => setAlias(event.target.value)}
          />
        </Field>
        <Field id="edit-expires" label="Expiration" hint="Clear the field to remove an expiration." error={fieldErrors.expiresAt}>
          <input
            id="edit-expires"
            name="expiresAt"
            type="datetime-local"
            value={expiresAt}
            aria-invalid={Boolean(fieldErrors.expiresAt)}
            aria-describedby={fieldErrors.expiresAt ? "edit-expires-error" : "edit-expires-hint"}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>
        {mutation.isError ? <Alert>{userMessage(mutation.error)}</Alert> : null}
        {saved && !mutation.isError ? <Alert tone="success">Link updated.</Alert> : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}

function expirationChanged(localValue: string, current: string | null): boolean {
  if (!localValue && !current) {
    return false;
  }
  if (!localValue || !current) {
    return true;
  }
  const next = fromDatetimeLocal(localValue);
  if (!next) {
    return true;
  }
  return new Date(next).getTime() !== new Date(current).getTime() && toDatetimeLocal(current) !== localValue;
}
