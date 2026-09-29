# API

Base URL for local development: `http://localhost:8080`.

Authenticated routes expect `Authorization: Bearer <token>`. A missing, malformed, or expired token, and a token for a deleted user, return 401 `Authentication required`.

Validation failures return 400 `Validation failed` with a `details` array. Unexpected failures return 500 `Internal Server Error`. Error bodies include `requestId` and do not include driver messages.

JSON bodies larger than 32 KiB return 413 `Request body is too large`.

## Auth

### `POST /api/auth/register`

Body: `name`, `email`, `password`. Password length is 8–128.

`201` returns `{ user, token }`. `user` has `id`, `name`, `email`, and `createdAt`. It does not include `passwordHash`.

`409` means the email is already registered. `429` means the client exceeded the register limit and includes `Retry-After`. `503` means Redis could not decide the limit. The user is not created.

### `POST /api/auth/login`

Body: `email`, `password`.

`200` returns `{ user, token }`. An unknown email and a wrong password both return 401 `Invalid email or password`. `429` and `503` match registration.

### `GET /api/auth/me`

Requires authentication. `200` returns `{ user }`.

## Links

All link routes require authentication. A missing link, a malformed id, and another user's link return 404 `Link not found`.

### `POST /api/links`

Body: `originalUrl`, optional `customAlias`, optional `expiresAt`.

`originalUrl` must be an `http` or `https` URL. `customAlias` is 3–32 characters: letters, numbers, and single hyphens. Reserved names are rejected: `analytics`, `api`, `dashboard`, `health`, `links`, `login`, `metrics`, `register`. `expiresAt` must be a future datetime.

`201` returns the link, including `shortUrl` built from `PUBLIC_BASE_URL`. `totalClicks` starts at 0. `409` means the short code is already in use. `429` and `503` match the link-creation limiter. A 503 does not insert the link.

### `GET /api/links`

Query: `page` (default 1), `limit` (default 20, max 50), `status` (`active` or `disabled`), `search` (max 200 characters), `sort` (`createdAt:desc` or `createdAt:asc`).

`200` returns `{ links, pagination }`. Results belong to the caller.

### `GET /api/links/:id`

`200` returns one owned link.

### `PATCH /api/links/:id`

Body may include `originalUrl`, `customAlias`, `status` (`active` or `disabled`), and `expiresAt` (`null` clears it). At least one field is required. Clients cannot set `userId`, `totalClicks`, timestamps, or `_id`.

`200` returns the updated link. Changing the alias, destination, status, or expiration deletes the redirect cache keys. If Redis cannot be reached first, the handler returns 503 and does not change the document. `409` means the new alias is taken.

### `DELETE /api/links/:id`

`204` with an empty body. The short code then 404s. Redis unavailable returns 503 and keeps the document.

## Redirect

### `GET /:shortCode`

No authentication. An active, unexpired link returns `302` and a `Location` header. The code match is case-sensitive.

Missing, disabled, expired, and non-HTTP destinations return 404 `Short link not found` and do not record a click. A successful redirect records a click and increments `totalClicks`. If that write fails, the response is still 302.

When Redis is down, a valid link still redirects from MongoDB. When MongoDB is down, a fresh cache entry can still 302 until its TTL. An uncached code cannot.

## Analytics

### `GET /api/links/:id/analytics`

Requires authentication. Query `range` is `7d`, `30d`, or `90d`. The default is `30d`.

`200` returns the link summary, click count for the range, UTC day buckets, devices, browsers, and up to 10 referrers. The body does not include `ipHash` or a raw IP. `country` is not part of this response. Another user's link is 404.

### `GET /api/dashboard/stats`

Requires authentication. `200` returns totals for the caller's links: link counts, `totalClicks`, `clicksToday` for the current UTC day, recent links, and top links.

## Health

### `GET /api/health/live`

`200` means the process is answering. It does not check MongoDB or Redis.

### `GET /api/health/ready`

`200` when MongoDB answers, including when Redis is down. The body reports each check as `up` or `down`. `503` when MongoDB does not answer.

### `GET /`

`200` returns the service name and `status: ok`.
