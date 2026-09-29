# Security

Shortify stores accounts and links in MongoDB and uses Redis for redirect caching and rate limits. The browser talks only to the API. CORS is not authentication. These controls are the ones the code implements. They are not a claim that the project is completely secure.

## Authentication

Registration and login accept a name, email, and password, then validate them with Zod. Passwords are hashed with Argon2id. The database stores `passwordHash` and never the plaintext password. `passwordHash` is excluded from normal user queries (`select: false`).

A successful login returns a signed JWT. The API verifies the signature and expiry on protected routes. A missing, malformed, or expired token returns 401 `Authentication required`. A valid token for a deleted user also returns 401. Login failures for an unknown email and a wrong password use the same 401 `Invalid email or password`.

There is no refresh token and no server-side revocation list. A token stays valid until it expires.

The dashboard stores the bearer token in `localStorage` under `shortify.accessToken`. Any script that runs on the web origin can read it. That is a different trade-off from an HttpOnly cookie. Logout and a 401 from an authenticated request remove the stored token. `VITE_*` values are public build configuration. `JWT_SECRET`, `ANALYTICS_IP_SALT`, `MONGODB_URI`, and `REDIS_URL` are not part of the web build.

## Authorization

Link and analytics reads and writes filter by the authenticated user id. A missing link and another user's link both return 404 `Link not found`. A short code that is missing, disabled, or expired returns 404 `Short link not found`.

A link id that is not a MongoDB ObjectId follows that same 404. If a Mongoose `CastError` still escapes, the error handler returns 400 `Invalid identifier` and does not send the driver message.

## Mass assignment

Create and update bodies use strict Zod objects. Update writes only `originalUrl`, `customAlias` (which sets `shortCode`), `status`, and `expiresAt`. Clients cannot set `userId`, `totalClicks`, `createdAt`, `updatedAt`, `passwordHash`, or `_id`.

## URL validation

`originalUrl` must parse as an absolute `http:` or `https:` URL with a hostname, at most 2048 characters, after trimming. `javascript:`, `data:`, `file:`, `ftp:`, and lookalikes such as `JAVASCRIPT:`, a whitespace-prefixed `javascript:` URL, or `javascript%3Aalert(1)` are rejected with 400. The URL parser accepts `https:example.com` as `https://example.com/`. That value is stored as entered. It is still an https URL.

Shortify does not fetch the destination. It stores the URL and sends the browser there with 302. Rejecting non-HTTP schemes stops the browser from being sent to those schemes. It is not SSRF protection, because the server does not request the destination.

## Aliases

Custom aliases are 3–32 characters: letters, numbers, and single hyphens. Matching is case-sensitive, so `AbC` and `abc` are different codes. Reserved names are rejected without regard to case: `analytics`, `api`, `dashboard`, `health`, `links`, `login`, `metrics`, and `register`. Generated codes are 7-character Base62. The unique `shortCode` index is the backstop for duplicates. Generated-code collisions retry a small number of times.

## Rate limiting

Register and login limits are per client IP. The Redis key is an HMAC-SHA256 of `request.ip` with `JWT_SECRET`, so the raw address is not the key. Link creation is limited per authenticated user id after validation. The limiter is a fixed window implemented with a Redis script (`INCR` and `EXPIRE` together). Over the limit returns 429 `Too many requests` and `Retry-After`. If Redis cannot decide, register, login, and link creation return 503 and do not write. List, update, delete, health, and redirects are not covered by this limiter.

`X-Forwarded-For` is not trusted. `trustProxy` is not enabled. Behind a reverse proxy, configure that explicitly or every client shares the proxy address.

A fixed window can allow up to twice the limit when requests land on both sides of a boundary.

## Cache

Redirect cache keys are `shortify:redirect:<shortCode>`. Values are version 2 JSON: `linkId`, an `http`/`https` location, and `expiresAt`. Invalid JSON, the wrong version, a missing field, or a non-HTTP location is ignored and deleted. MongoDB is then read.

A cache hit redirects without reading MongoDB for the destination. A miss, or a Redis read failure, reads MongoDB. Redirects still return 302 when Redis is down.

The Redis client does not reconnect after the connection ends. `retryStrategy` returns null so a dead connection cannot queue requests. If Redis stops and later starts again, this process keeps treating Redis as down until the API process starts again.

Updates and deletes ping Redis before writing MongoDB. If that ping fails they return 503 and leave the document unchanged, so a later redirect cannot keep a stale cached destination that the write could not invalidate.

MongoDB writes and Redis deletes are not one transaction. A crash after the write and before the delete can leave a stale entry until its TTL. The TTL is the shorter of `REDIRECT_CACHE_TTL_SECONDS` (default 300) and the time until `expiresAt`.

If MongoDB is down and a valid cache entry exists, that redirect still returns 302 until the TTL. Redis is not the source of truth. A cache miss while MongoDB is down cannot resolve the link and returns a safe 500. Readiness returns 503 when MongoDB is down.

## Why Redis failures differ

Redirects fail open to MongoDB so an existing short link keeps working. Register, login, and link creation fail closed because the rate limiter cannot decide. Readiness stays 200 when MongoDB is up and Redis is down, and the body says `redis: down`. Liveness only means the process is answering.

## Analytics privacy

A successful redirect inserts a click event and then `$inc`s `totalClicks`. Those two writes are not a transaction. If either fails, the redirect is still 302 and the failure is logged. Missing, disabled, expired, and invalid destinations do not create events.

The raw IP is not stored. `ipHash` is SHA-256 of `ANALYTICS_IP_SALT`, a newline, and the trimmed IP. The hash and the salt are not returned by the API. The raw User-Agent is not stored. It is truncated to 2048 characters and classified into a device and browser. Referrers are truncated to 2048 characters. `country` is always null. There is no GeoIP lookup.

## HTTP configuration

`CORS_ORIGIN` is one allowed origin, for example `http://localhost:3000`. The API passes it as an allow-list. A browser origin that is not on the list does not receive `Access-Control-Allow-Origin`. The API does not send `Access-Control-Allow-Origin: *`. Allowed methods are `GET`, `HEAD`, `POST`, `PATCH`, and `DELETE`. A production deployment sets `CORS_ORIGIN` to the real dashboard origin. Local development uses `http://localhost:3000`.

`@fastify/helmet` sets the usual API headers (`X-Content-Type-Options: nosniff`, frame and referrer policies, and others). Content-Security-Policy is off on the API because the SPA is a separate origin and sets its own document. `Cross-Origin-Resource-Policy` is `cross-origin` so the dashboard can read JSON. `cross-origin` does not grant access by itself. CORS still has to allow the origin.

JSON bodies are limited to 32 KiB. Larger requests return 413 `Request body is too large`.

Unsupported methods use Fastify's normal 404. `GET /api/auth/login` and `PUT /api/links/:id` do not run the POST or PATCH handlers.

The nginx image adds `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options`, and falls back to `index.html` for SPA routes.

## Logging

Pino redacts `Authorization`, `Cookie`, `password`, `passwordHash`, and the names `JWT_SECRET`, `ANALYTICS_IP_SALT`, `MONGODB_URI`, and `REDIS_URL` when they appear as those log fields. Request logs keep the method and a URL truncated at 512 characters. They do not include the body. Analytics and cache failure logs include an operation name and an error message, not the IP, salt, referrer, or User-Agent.

Unexpected errors return `Internal Server Error` and a request id. The client does not receive driver messages, stack traces, or filesystem paths. The request id comes from `x-request-id` when that header is 1–128 characters, otherwise a UUID.

## Shutdown

`SIGINT` and `SIGTERM` stop the Fastify server, then disconnect MongoDB and Redis, then exit. A second signal during shutdown is ignored.

## Indexes

- `users.email` unique, for login and duplicate registration.
- `links.shortCode` unique, for redirects and alias conflicts.
- `links` `{ userId, createdAt }` and `{ userId, status, createdAt }`, for the owner's list.
- `clickevents` `{ linkId, timestamp }` descending, for per-link ranges.

Dashboard `clicksToday` uses the owner's link ids and a count. It does not have a separate index beyond those.
