# Changelog

## 1.0.0 - 2026-09-29

First portfolio release. Shortify is not a deployed production service.

### Added

- Account registration and login with Argon2id and JWT bearer tokens
- Base62 short codes, custom aliases, expiration, enable, and disable
- Owner-scoped link list, get, update, and delete
- HTTP 302 redirects with Redis cache-aside and MongoDB fallback
- Distributed fixed-window rate limits for register, login, and link creation
- Click events, atomic `totalClicks`, per-link analytics, and a dashboard
- React dashboard for auth, links, and analytics
- Docker Compose for MongoDB, Redis, the API, and nginx
- Integration tests with Testcontainers, plus web tests
- GitHub Actions CI for typecheck, tests, and build

### Security

- `http` and `https` destinations only
- Helmet, a single CORS origin, and a 32 KiB JSON body limit
- Owner checks that return 404 for another user's link
- Hashed client addresses in analytics, with no raw IP stored
- Log redaction for passwords, hashes, and authorization headers

### Architecture

- One Fastify service: routes, controllers, services, then MongoDB and Redis
- MongoDB is the source of truth
- Redis is the redirect cache and the shared rate-limit counter

### Known limitations

- Bearer tokens live in `localStorage`, with no refresh or revocation
- The rate limiter can burst at a window boundary
- `trustProxy` is off
- The Redis client does not reconnect after the connection ends
- Cache invalidation and the two analytics writes are not transactions
- No negative cache, stampede lock, GeoIP, or custom domains

## Release notes

Shortify v1.0.0 is a full-stack URL shortener and analytics project.

It includes JWT authentication, Argon2id password hashing, Base62 codes and custom aliases, Redis cache-aside redirects, a Redis fixed-window rate limit shared across API processes, click analytics with MongoDB aggregations, a React dashboard, Docker Compose, and integration tests against real MongoDB and Redis.

MongoDB remains the source of truth. A redirect uses Redis first and falls back to MongoDB. Register, login, and link creation return 503 when the rate limiter cannot run. Analytics writes are best-effort and are not one transaction with the redirect.

The access token is stored in browser `localStorage`. There is no refresh token. The Redis client does not reconnect after its connection ends. See the known limitations above.
