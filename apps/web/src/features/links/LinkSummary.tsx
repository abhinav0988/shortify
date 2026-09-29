import type { Link } from "@shortify/shared";
import { Link as RouterLink } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { formatExpiration, formatTimestamp, isHttpUrl } from "../../utils/format";
import { CopyButton } from "./CopyButton";
import { DeleteLinkButton } from "./DeleteLinkButton";
import { StatusButton } from "./StatusButton";

export function LinkSummary({ link, layout }: { link: Link; layout: "table" | "card" | "detail" }) {
  const destination = isHttpUrl(link.originalUrl) ? (
    <a className="truncate" href={link.originalUrl} title={link.originalUrl} rel="noreferrer">
      {link.originalUrl}
    </a>
  ) : (
    <span className="truncate" title={link.originalUrl}>
      {link.originalUrl}
    </span>
  );

  const actions = (
    <div className="actions">
      <CopyButton value={link.shortUrl} />
      {layout !== "detail" ? <RouterLink to={`/links/${link.id}`}>View</RouterLink> : null}
      <RouterLink to={`/links/${link.id}/analytics`}>Analytics</RouterLink>
      {layout === "detail" ? (
        <a href="#edit">Edit</a>
      ) : (
        <RouterLink to={`/links/${link.id}#edit`}>Edit</RouterLink>
      )}
      <StatusButton link={link} />
      <DeleteLinkButton linkId={link.id} stayOnPage={layout !== "detail"} />
    </div>
  );

  if (layout === "detail") {
    return (
      <dl className="details">
        <div>
          <dt>Short code</dt>
          <dd>{link.shortCode}</dd>
        </div>
        <div>
          <dt>Short URL</dt>
          <dd className="url-break">{link.shortUrl}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd className="url-break">{link.originalUrl}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Badge status={link.status} />
          </dd>
        </div>
        <div>
          <dt>Clicks</dt>
          <dd>{link.totalClicks}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(link.createdAt)}</dd>
        </div>
        <div>
          <dt>Expiration</dt>
          <dd>{formatExpiration(link.expiresAt)}</dd>
        </div>
        <div className="detail-actions">
          <dt>Actions</dt>
          <dd>{actions}</dd>
        </div>
      </dl>
    );
  }

  if (layout === "card") {
    return (
      <article className="link-card">
        <header>
          <strong className="url-break">{link.shortUrl}</strong>
          <Badge status={link.status} />
        </header>
        {destination}
        <p>
          {link.totalClicks} clicks · Created {formatTimestamp(link.createdAt)} · Expires {formatExpiration(link.expiresAt)}
        </p>
        {actions}
      </article>
    );
  }

  return (
    <tr>
      <td>
        <span className="truncate" title={link.shortUrl}>
          {link.shortUrl}
        </span>
      </td>
      <td>{destination}</td>
      <td>{link.totalClicks}</td>
      <td>
        <Badge status={link.status} />
      </td>
      <td>{formatTimestamp(link.createdAt)}</td>
      <td>{formatExpiration(link.expiresAt)}</td>
      <td>{actions}</td>
    </tr>
  );
}
