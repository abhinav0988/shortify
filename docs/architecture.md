# Architecture

Shortify is one API and one web app. MongoDB stores accounts, links, and clicks. Redis caches redirects and counts rate limits. The browser talks only to the API.

```text
React / Vite
      │  HTTP + Bearer JWT
      ▼
Fastify routes
      │
      ▼
Controllers
      │
      ▼
Services
   ┌──┴────┐
   ▼       ▼
MongoDB   Redis
source    cache and
of truth  rate limit
```

There is no message queue, search cluster, or separate analytics database. Click history lives in MongoDB.

## Repository

npm workspaces, Node.js 22, TypeScript.

| Path | Package | Role |
| --- | --- | --- |
| `apps/api` | `@shortify/api` | Fastify service. Tests live next to the modules they cover. |
| `apps/web` | `@shortify/web` | React dashboard. |
| `packages/shared` | `@shortify/shared` | Response and request types used by both sides. |
| `docs` | | This file and `docs/security.md`. |

The web package does not import API source. Both sides import `@shortify/shared`.

```text
apps/api/src
  server.ts                 process entry, connections, SIGTERM/SIGINT
  app.ts                    Fastify app, CORS, helmet, error handler, route order
  config/                   env parsing and .env loading
  database/mongoose.ts      MongoDB connection and ping
  cache/                    Redis client, redirect cache, rate limiter
  plugins/                  JWT, authenticate, health
  modules/auth              routes, controller, service, schema, user model
  modules/links             routes, controller, service, schema, model, short codes
  modules/redirects         routes, controller, service
  modules/analytics         routes, controller, service, schema, click model
  utils/                    logger, HTTP errors, validation

apps/web/src
  App.tsx                   routes
  pages/                    one screen per route
  features/                 forms and link actions
  services/                 fetch client, session, TanStack Query
  components/               layout and UI

packages/shared/src
  auth.ts  links.ts  analytics.ts  health.ts
```

## Runtime

Local development runs the API with `npm run dev` and Vite with `npm run dev:web`.

| Process | Default URL |
| --- | --- |
| API | `http://localhost:8080` |
| Vite | `http://localhost:3000` |
| MongoDB | `mongodb://127.0.0.1:27017/shortify` |
| Redis | `redis://127.0.0.1:6379` |

Docker Compose runs four services: `mongo`, `redis`, `api`, and `web`. Inside Compose the API uses the hostnames `mongo` and `redis`. The web image is nginx serving the Vite build. nginx falls back to `index.html`, so a refresh of `/dashboard` or `/links/:id` stays in the SPA.

Short links use the API origin (`PUBLIC_BASE_URL`), not the dashboard origin. `http://localhost:8080/aB7xK2` is the API. `http://localhost:3000` is the dashboard.

## Layers

Routes define the path, method, and authentication hook, then hand the request to a controller.

Controllers read the authenticated user, validated body, params, query, and request metadata. They call a service and set the HTTP status. They do not query MongoDB, talk to Redis directly, hash passwords, generate short codes, or run aggregations. Zod parsing and the rate-limit call stay here, after one another, so a bad body is still 400 before a 429 or 503.

Services own the business rules: Argon2id, link creation and ownership, cache-aside redirects, click recording, and aggregations. They call Mongoose models and the cache or rate-limit modules.

Models describe the MongoDB documents and indexes. Redis access stays in `cache/redirect-cache.ts` and `cache/rate-limit.ts`.

There is no repository, dependency-injection container, or command bus. The direction is routes → controllers → services → models and cache modules. Services do not import controllers.

## API composition

`server.ts` loads the environment, connects MongoDB, ensures indexes, builds the Fastify app, then connects Redis. A Redis connection failure is logged and the process still listens. `SIGINT` and `SIGTERM` close Fastify, then MongoDB, then Redis.

`app.ts` registers, in order:

1. Helmet and CORS
2. JWT
3. Auth, links, and analytics routes
4. Health and `GET /`
5. Redirect routes

Redirects are registered last. `GET /:shortCode` must not capture `/api`, `/health`, or the other fixed paths. Those names are also reserved as aliases.

Every response can carry `x-request-id`. If the incoming header is 1–128 characters it is kept. Otherwise the API generates a UUID. Error bodies include that id. Unexpected failures return `Internal Server Error` and do not send driver messages or stack traces to the client.

JSON bodies are limited to 32 KiB.

## Data model

MongoDB database `shortify`. Three collections.

### users

| Field | Notes |
| --- | --- |
| `name` | Trimmed, 1–80 characters |
| `email` | Trimmed, lowercased, unique |
| `passwordHash` | Argon2id. `select: false` on queries |

Index: `{ email: 1 }` unique.

### links

| Field | Notes |
| --- | --- |
| `userId` | Owner |
| `shortCode` | Generated Base62 or custom alias. Unique, case-sensitive |
| `originalUrl` | `http:` or `https:` only |
| `customAlias` | `true` when the code was chosen by the user |
| `status` | `active` or `disabled`. Default `active` |
| `expiresAt` | `null` or a future date. No TTL index |
| `totalClicks` | Starts at 0. Increased with `$inc` |
| `createdAt`, `updatedAt` | Mongoose timestamps |

Indexes:

- `{ shortCode: 1 }` unique, for redirects and alias conflicts
- `{ userId: 1, createdAt: -1 }` for the owner's list
- `{ userId: 1, status: 1, createdAt: -1 }` for a filtered list

Expiration is enforced in the redirect handler. The document stays so click history can still refer to it.

### clickevents

| Field | Notes |
| --- | --- |
| `linkId` | Link that was redirected |
| `timestamp` | Time of the successful redirect |
| `country` | Always `null`. No GeoIP lookup |
| `device` | `desktop`, `mobile`, `tablet`, `bot`, or `unknown` |
| `browser` | `chrome`, `firefox`, `safari`, `edge`, `other`, or `unknown` |
| `referrer` | Truncated to 2048 characters, or `null` |
| `ipHash` | SHA-256 of the salt, a newline, and the trimmed IP. Not returned by the API |

Index: `{ linkId: 1, timestamp: -1 }` for per-link time ranges.

The raw IP and the raw User-Agent are not stored.

## Request paths

### Register

```text
POST /api/auth/register
  → Zod (name, email, password)
  → rate limit by client IP
  → Argon2id
  → MongoDB users
  → JWT
```

A duplicate email returns 409. Redis must answer the rate-limit script. If it cannot, the handler returns 503 and does not create the user.

### Login

```text
POST /api/auth/login
  → Zod
  → rate limit by client IP
  → MongoDB users
  → Argon2id verify
  → JWT
```

An unknown email and a wrong password both return 401 `Invalid email or password`. Redis unavailable returns 503 before the password check.

### Current user

```text
GET /api/auth/me
  → verify JWT
  → MongoDB users
```

A missing, malformed, or expired token returns 401. A token whose user was deleted returns 401. This route is not rate limited.

### Create a link

```text
POST /api/links
  → verify JWT
  → Zod (originalUrl, optional alias, optional expiresAt)
  → rate limit by user id
  → Base62 or custom alias
  → MongoDB links, unique shortCode
```

Generated codes are 7-character Base62. On a duplicate generated code the service tries again, up to 5 times. A duplicate custom alias returns 409. Reserved names (`analytics`, `api`, `dashboard`, `health`, `links`, `login`, `metrics`, `register`) are rejected without regard to case. Stored codes stay case-sensitive: `AbC` and `abc` are different links.

Redis unavailable returns 503 and does not insert the link.

### List, get, update, delete

```text
authenticated request
  → ownership filter { _id, userId }
  → MongoDB
  → on update or delete, Redis DEL of the affected short codes
```

A missing id, a malformed ObjectId, and another user's id all return 404 `Link not found`. Update writes only `originalUrl`, `customAlias` (which replaces `shortCode`), `status`, and `expiresAt`. `userId`, `totalClicks`, timestamps, and `_id` are not taken from the body.

Update and delete ping Redis before writing MongoDB. If that ping fails they return 503 and leave the document unchanged, so a cached destination cannot outlive a write that failed to invalidate it.

The MongoDB write and the Redis delete are not one transaction. A crash between them can leave a stale cache entry until its TTL.

List query parameters are `page`, `limit` (max 50), `status`, `search` (max 200 characters, case-insensitive regular expression), and `sort` (`createdAt:asc` or `createdAt:desc`).

### Redirect

```text
GET /:shortCode
  → Redis GET shortify:redirect:<shortCode>
       hit and still valid → use cached location
       miss, bad JSON, or Redis error → MongoDB links by shortCode
  → require status active, expiresAt in the future, http(s) destination
  → insert clickevents, then $inc links.totalClicks
  → 302 Location: originalUrl
```

Missing, disabled, expired, and non-HTTP destinations return 404 `Short link not found` and do not record a click. Those misses are not written to Redis.

A cache value is version 2 JSON: `linkId`, `location`, `expiresAt`. The location must be `http:` or `https:`. Anything else is deleted and the request falls through to MongoDB. The TTL is the shorter of `REDIRECT_CACHE_TTL_SECONDS` (default 300) and the whole seconds until `expiresAt`. A link with less than one second left still redirects and is not cached.

A cache hit does not read MongoDB for the destination. It still records the click using the cached `linkId`. If MongoDB is down and a valid cache entry exists, that redirect still returns 302 until the TTL. An uncached code cannot be resolved and returns 500. Redis is not the source of truth.

Redis read or write failures on this route are logged and ignored. The redirect still uses MongoDB.

The two analytics writes are awaited and then the 302 is sent. They are not one transaction. If the insert or the `$inc` fails, the redirect is still 302 and the failure is logged. The event count and `totalClicks` can drift.

### Analytics and dashboard

```text
GET /api/links/:id/analytics?range=7d|30d|90d
  → verify JWT
  → link must belong to that user
  → aggregation on clickevents for that linkId and rolling window

GET /api/dashboard/stats
  → verify JWT
  → aggregation and counts on that user's links
  → clicksToday counts clickevents since UTC midnight for those link ids
```

Day buckets use `$dateToString` in UTC. The default range is `30d`. Referrers are the top 10. An empty referrer is reported as `direct` only in the aggregation. Device and browser values come from a small classifier, not a User-Agent library.

## Redis keys

| Key | Value | TTL |
| --- | --- | --- |
| `shortify:redirect:<shortCode>` | v2 JSON `{ linkId, location, expiresAt }` | cache TTL, capped by `expiresAt` |
| `shortify:ratelimit:<scope>:<identity>:<window>` | integer counter | the window length |

Rate-limit scopes are `register`, `login`, and `link-create`. Register and login identities are HMAC-SHA256 of `request.ip` with `JWT_SECRET`. The raw IP is not the key. Link creation uses the authenticated user id after validation. One Lua script runs `INCR` and `EXPIRE` together, so every API process shares the same counter.

Over the limit returns 429 `Too many requests` and `Retry-After`. Defaults are 5 registrations, 10 logins, and 10 link creations per 60 seconds.

`X-Forwarded-For` is not trusted. `trustProxy` is not enabled. Behind a reverse proxy, configure that before client IP limits mean the real client.

The Redis client uses `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, and a retry strategy that stops. After the connection ends, this process keeps treating Redis as down until the API process starts again.

## Frontend

React 19, Vite, React Router, TanStack Query.

| Route | Who | What it loads |
| --- | --- | --- |
| `/` | anyone | signed-in users go to `/dashboard`, others to `/login` |
| `/login`, `/register` | guests | auth forms |
| `/dashboard` | signed in | `GET /api/dashboard/stats` and the create form |
| `/links` | signed in | `GET /api/links` with search, status, sort, and page |
| `/links/:id` | signed in | one link, edit, enable, disable, delete |
| `/links/:id/analytics` | signed in | `GET /api/links/:id/analytics` |
| anything else | anyone | not-found page |

The access token is stored in `localStorage` under `shortify.accessToken` and sent as `Authorization: Bearer`. Logout and a 401 from an authenticated call remove it. The API builds `shortUrl` from `PUBLIC_BASE_URL`. The browser copies that string. It does not invent short codes.

Buttons that create, save, delete, enable, or disable stay disabled while the mutation is pending. A successful mutation invalidates the link and dashboard queries.

`VITE_API_BASE_URL`, then `VITE_API_URL`, selects the API origin. Those values are public build settings. `JWT_SECRET`, `ANALYTICS_IP_SALT`, `MONGODB_URI`, and `REDIS_URL` are not in the web bundle.

## Failure policy

| Dependency | Redirect | Register, login, create | Update, delete | Readiness |
| --- | --- | --- | --- | --- |
| Redis down, MongoDB up | 302 from MongoDB | 503, no write | 503, document unchanged | 200, `redis: down` |
| MongoDB down, cache hit | 302 from Redis until TTL | 500 | 500 | 503, `mongodb: down` |
| MongoDB down, cache miss | 500 | 500 | 500 | 503 |

Liveness (`GET /api/health/live`) only means the process is answering. It does not check MongoDB or Redis.

## Decisions

The shape above is intentional. Separate records are not kept for each choice.

- One modular monolith. Routes, controllers, and services live in one API. A repository layer, command bus, or extra service process is not used.
- MongoDB is the source of truth for users, links, and clicks. Unique indexes decide email and short-code conflicts under concurrency.
- Redis is cache-aside for redirects and a shared fixed-window counter for rate limits. A cache hit can answer while MongoDB is down until the TTL. That does not make Redis authoritative.
- Analytics writes a click event and then `$inc`s `totalClicks`. Those writes are best-effort and are not one transaction. A failed write still returns 302.
- The Redis client does not reconnect after the connection ends. Restart the API process to use Redis again.

## Scaling

Additional API processes can share one MongoDB and one Redis. Rate-limit keys and redirect cache keys are then shared. This repository does not include a measured capacity, a load-balancer config, or a claim about request rate. `trustProxy` is off, so a proxy in front of several instances must be configured before client IP limits see the caller.

Endpoint details are in [api.md](api.md).

## What this system does not include

No Kafka, RabbitMQ, Socket.IO, GraphQL, Elasticsearch, ClickHouse, Kubernetes, custom domains, teams, billing, OAuth, refresh tokens, password reset, admin panel, or notifications. Security controls and the known limits of the cache, limiter, and analytics writes are in [security.md](security.md).
