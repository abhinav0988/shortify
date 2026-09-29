import type { Link } from "@shortify/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert } from "../../components/feedback/Alert";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { createLink } from "../../services/links.api";
import { refreshLinkQueries } from "../../services/query-client";
import { isHttpUrl } from "../../utils/format";
import { userMessage } from "../../utils/user-message";
import { validateAlias, validateFutureExpiration, validateOriginalUrl } from "../../utils/validation";
import { CopyButton } from "./CopyButton";

export function CreateLinkForm() {
  const queryClient = useQueryClient();
  const [originalUrl, setOriginalUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ originalUrl?: string; alias?: string; expiresAt?: string }>({});
  const [created, setCreated] = useState<Link | null>(null);

  const mutation = useMutation({
    mutationFn: createLink,
    onSuccess: async (link) => {
      setCreated(link);
      setOriginalUrl("");
      setAlias("");
      setExpiresAt("");
      await refreshLinkQueries(queryClient);
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

    setCreated(null);
    mutation.mutate({
      originalUrl: originalUrl.trim(),
      ...(alias.trim() ? { customAlias: alias.trim() } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    });
  }

  return (
    <Card title="Create a short link">
      <form className="stack" onSubmit={submit} noValidate>
        <Field id="original-url" label="Original URL" error={fieldErrors.originalUrl}>
          <input
            id="original-url"
            name="originalUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={originalUrl}
            aria-invalid={Boolean(fieldErrors.originalUrl)}
            aria-describedby={fieldErrors.originalUrl ? "original-url-error" : undefined}
            onChange={(event) => setOriginalUrl(event.target.value)}
            required
          />
        </Field>
        <Field id="custom-alias" label="Custom alias" hint="Optional. 3–32 letters, numbers, and single hyphens." error={fieldErrors.alias}>
          <input
            id="custom-alias"
            name="customAlias"
            value={alias}
            autoComplete="off"
            aria-invalid={Boolean(fieldErrors.alias)}
            aria-describedby={fieldErrors.alias ? "custom-alias-error" : "custom-alias-hint"}
            onChange={(event) => setAlias(event.target.value)}
          />
        </Field>
        <Field id="expires-at" label="Expiration" hint="Optional. Leave blank for a link that does not expire." error={fieldErrors.expiresAt}>
          <input
            id="expires-at"
            name="expiresAt"
            type="datetime-local"
            value={expiresAt}
            aria-invalid={Boolean(fieldErrors.expiresAt)}
            aria-describedby={fieldErrors.expiresAt ? "expires-at-error" : "expires-at-hint"}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>
        {mutation.isError ? <Alert>{userMessage(mutation.error)}</Alert> : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create short link"}
        </Button>
      </form>
      {created ? (
        <div className="success-panel" role="status">
          <p>Short link created.</p>
          <p className="url-break">{created.shortUrl}</p>
          <div className="actions">
            <CopyButton value={created.shortUrl} />
            {isHttpUrl(created.shortUrl) ? (
              <a className="text-link" href={created.shortUrl} target="_blank" rel="noreferrer">
                Open short URL
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
