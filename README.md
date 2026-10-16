# triage-api

[![CI](https://github.com/SiyaCodesStuff/triage-api/actions/workflows/ci.yml/badge.svg)](https://github.com/SiyaCodesStuff/triage-api/actions/workflows/ci.yml)

A support-ticket REST API that turns incoming issues into an clear workflow with ownership and assignment. Customers track their own tickets; agents triage the queue; administrators manage access. Permissions are checked against the current database role on every authenticated request.

## Features

- Register and sign in with Argon2id passwords, lowercase emails and case-insensitive email uniqueness.
- Short-lived access JWTs, rotating refresh cookies and refresh-token reuse detection.
- USER, AGENT and ADMIN permissions, including ownership checks and immediate role-change enforcement.
- Tickets with assignment, priorities, explicit status transitions, search, filters and pagination.
- Paginated comments, author/admin deletion and a closed-ticket write guard.
- PostgreSQL constraints, indexes and update-timestamp triggers; idempotent administrator seeding.
- Generated OpenAPI 3.1 and Swagger UI, security headers, CSRF protection and rate limiting.
- Graceful shutdown, health/readiness probes, CI, a multi-stage container and a Bruno collection.

## Stack

| Layer                 | Technology                                                         |
| --------------------- | ------------------------------------------------------------------ |
| Runtime               | Node.js 24 (see `.nvmrc`), WSL2 for local development              |
| HTTP                  | Express 5, TypeScript strict, NodeNext ESM (`.js` import suffixes) |
| Data                  | PostgreSQL 17, Drizzle ORM / Drizzle Kit, node-postgres            |
| Validation / API docs | Zod 4, Zod-to-OpenAPI, Swagger UI                                  |
| Authentication        | Argon2id, signed JWTs, SHA-256 refresh-token digests               |
| Security / logging    | Helmet, CORS allowlist, express-rate-limit, Pino                   |
| Tests / tooling       | Vitest, Supertest, V8 coverage, ESLint, Prettier                   |
| Delivery              | GitHub Actions, Docker Compose, Debian slim runtime                |

## Architecture

```mermaid
flowchart LR
  Client[Browser / curl / Bruno] --> HTTP[Express 5]
  HTTP --> Middleware[Headers / CORS / limits / CSRF / Zod]
  Middleware --> Auth[JWT verification + current DB identity]
  Auth --> Routes[Auth / users / tickets / comments]
  Routes --> Services[Services and authorization]
  Services --> ORM[Drizzle + pg pool]
  ORM --> DB[(PostgreSQL)]
  Auth --> DB
  HTTP --> Probes[Unversioned health / ready]
  HTTP --> Docs[Optional docs / openapi.json]
  Docs --> Spec[Generated OpenAPI 3.1]
```

```mermaid
erDiagram
  users ||--o{ tickets : creates
  users o|--o{ tickets : assigned
  users ||--o{ comments : authors
  tickets ||--o{ comments : contains
  users ||--o{ refresh_sessions : owns
  users {
    uuid id PK
    text name
    text email "unique lower(email)"
    text password_hash
    role role "USER / AGENT / ADMIN"
    timestamptz created_at
    timestamptz updated_at
  }
  tickets {
    uuid id PK
    text title
    text description
    ticket_status status
    ticket_priority priority
    uuid created_by FK
    uuid assigned_to FK "nullable"
    timestamptz created_at
    timestamptz updated_at
  }
  comments {
    uuid id PK
    uuid ticket_id FK
    uuid author_id FK
    text body
    timestamptz created_at
    timestamptz updated_at
  }
  refresh_sessions {
    uuid id PK
    uuid user_id FK
    text token_hash UK "SHA-256 only"
    timestamptz expires_at
    timestamptz revoked_at "nullable"
    timestamptz created_at
  }
```

Deleting a ticket cascades to comments. User deletion is restricted by authored tickets/comments, clears assignments and cascades refresh sessions. Public responses never include password hashes or refresh-token digests.

## Authentication flow

```mermaid
sequenceDiagram
  participant C as Client
  participant A as API
  participant D as PostgreSQL
  C->>A: Register/login + X-CSRF-Protection: 1
  A->>A: Lowercase email, hash/verify Argon2id password
  A->>D: Store SHA-256 refresh digest
  A-->>C: Public user + HttpOnly access/refresh cookies
  C->>A: Protected request + access cookie (or Bearer JWT)
  A->>A: Verify JWT, use sub as identity
  A->>D: Load current user id and role
  A-->>C: Authorized response (401 if deleted)
  C->>A: Refresh cookie + CSRF header
  A->>D: Lock user, revoke old session, insert new digest
  A-->>C: Rotated cookies + public user
  Note over A,D: Reuse of a revoked valid refresh token revokes all user sessions
  C->>A: Logout + refresh cookie + CSRF header
  A->>D: Revoke presented refresh session
  A-->>C: Clear cookies, 204
```

Register/login/refresh return `{ "data": <public user> }`; tokens are sent as cookies, not JSON. Cookies are HttpOnly, SameSite=Strict and Secure in production. The access cookie is scoped to `/`; the refresh cookie to `/api/v1/auth`. All protected routes also accept an access Bearer JWT. Every unsafe `/api/v1` request requires `X-CSRF-Protection: 1`, even with Bearer authentication. Browser requests need `credentials: "include"`.

See [docs/auth.md](docs/auth.md) for CSRF reasoning, refresh concurrency and revocation semantics.

## Local setup (WSL2)

Use an Ubuntu WSL2 shell, Node from `.nvmrc`, and Docker Desktop with WSL integration enabled. Keep the checkout in the Linux filesystem. Commands below run from the project root.

```sh
nvm install
nvm use
npm ci
cp .env.example .env
```

Edit your local `.env`: set distinct random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values (at least 32 characters each). Generate each independently with `openssl rand -hex 32`. Keep database credentials consistent between `DATABASE_URL` and `POSTGRES_*`; use percent-encoded credentials in URLs when needed. Never commit `.env`.

| Setting                                                              | Local default / purpose                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`, `PORT`                                                   | `development`, `3000`                                                               |
| `DATABASE_URL`                                                       | `postgres://triage:triage@localhost:5432/triage`                                    |
| `TEST_DATABASE_URL`                                                  | Separate disposable `triage_test` database                                          |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Compose database configuration; local defaults in `.env.example`                    |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                            | Required, distinct signing secrets                                                  |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`                              | `15m`, `7d`                                                                         |
| `CORS_ORIGINS`                                                       | Comma-separated trusted HTTP(S) origins; unset disables cross-origin browser access |
| `TRUST_PROXY`                                                        | Trusted proxy hops; default `0`                                                     |
| `ENABLE_DOCS`                                                        | `true` / `false`; defaults on outside production, off in production                 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                                      | Required only for seed; password 10–128 characters                                  |

```sh
npm run db:up
npm run db:migrate
npm run db:migrate:test
```

On a fresh Compose volume, initialization creates `triage_test` as well as the application database. With an older volume, create the test database once:

```sh
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" triage_test'
```

Wait for Postgres to become healthy before migrating. Add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to your local environment or `.env`, then:

```sh
npm run db:seed
npm run dev
```

Seed creates one ADMIN, normalizes its email and hashes its password. Repeated/concurrent runs preserve an existing admin and password; an existing non-admin email fails rather than being promoted. Production requires `npm run db:seed -- --allow-production`. Seeding never runs automatically at startup.

Visit [health](http://localhost:3000/health), [readiness](http://localhost:3000/ready), [Swagger UI](http://localhost:3000/docs/) and [OpenAPI](http://localhost:3000/openapi.json). Business routes use `/api/v1`; `/health`, `/ready`, `/docs` and `/openapi.json` remain unversioned. Old `/api` routes are not mounted.

## Scripts

| Command                    | Purpose                                             |
| -------------------------- | --------------------------------------------------- |
| `npm run dev`              | Watch TypeScript source with tsx; load local `.env` |
| `npm run build`            | Compile into `dist/`                                |
| `npm start`                | Run compiled server; load local `.env`              |
| `npm run lint`             | ESLint                                              |
| `npm run typecheck`        | Application and Drizzle TypeScript checks           |
| `npm test`                 | Unit/API tests without a live database              |
| `npm run test:watch`       | Watch unit tests                                    |
| `npm run test:integration` | Tests against migrated `TEST_DATABASE_URL`          |
| `npm run test:coverage`    | Unit + integration projects and V8 coverage         |
| `npm run format`           | Format the repository (writes files)                |
| `npm run db:up`            | Start Compose Postgres                              |
| `npm run db:down`          | Stop Compose services; keep named volumes           |
| `npm run db:generate`      | Generate a new migration from schema changes        |
| `npm run db:migrate`       | Migrate application database                        |
| `npm run db:migrate:test`  | Migrate dedicated test database                     |
| `npm run db:seed`          | Idempotent admin seed                               |
| `npm run db:studio`        | Open Drizzle Studio                                 |

Never edit an applied migration. Generate a new migration for schema changes. Existing case-insensitive email duplicates and rows violating integrity checks must be resolved before applying the integrity migration; it fails rather than silently rewriting data.

## API contracts and permissions

Successful JSON responses use `{ "data": ... }`; DELETE/logout return 204 without a body. Errors use `{ "error": { "code": "...", "message": "...", "details": {} } }` with optional `details`.

| Endpoint (under `/api/v1`)                        | Access / behavior                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /auth/register`, `/auth/login`              | Public with CSRF header; cookies issued                                             |
| `POST /auth/refresh`, `/auth/logout`              | Refresh cookie; logout is safe without one                                          |
| `GET /users/me`                                   | Any authenticated user                                                              |
| `GET /users`, `GET /users/{userId}`               | ADMIN only                                                                          |
| `PATCH /users/{userId}/role`                      | ADMIN; cannot demote self                                                           |
| `GET /tickets`, `GET /tickets/{ticketId}`         | USER owns ticket; staff see all                                                     |
| `POST /tickets`                                   | Authenticated; caller owns new OPEN ticket                                          |
| `PATCH /tickets/{ticketId}`                       | USER edits own OPEN title/description; staff also change status/priority/assignment |
| `DELETE /tickets/{ticketId}`                      | ADMIN only                                                                          |
| `GET /tickets/{ticketId}/comments`                | Ticket must be visible; oldest first                                                |
| `POST /tickets/{ticketId}/comments`               | Ticket must be visible and not CLOSED (otherwise 409)                               |
| `DELETE /tickets/{ticketId}/comments/{commentId}` | Visible ticket; comment author or ADMIN                                             |

USER requests for another person's ticket return 404. Assignment targets must be AGENT or ADMIN (or `null` to clear). Staff title/description editing is supported. USER creation accepts initial priority; subsequent priority changes require staff.

Allowed status transitions are `OPEN → IN_PROGRESS → RESOLVED → CLOSED` and `RESOLVED → OPEN`. Other transitions, including resending the current status, return 400. Ticket titles are trimmed, 3–200 characters at the API; descriptions are 1–10,000. Comment bodies are trimmed, 1–4,000 characters at the API. Database checks additionally require nonempty trimmed titles/bodies, with caps of 200/5,000 characters respectively.

Ticket listing accepts `page` (1), `pageSize` (20, max 100), `status`, `priority`, `assignedTo`, `createdBy`, `q`, `sort` (`createdAt|priority|status`) and `order` (`asc|desc`, default desc). Filters combine with AND; `q` matches title OR description case-insensitively, treating `%` and `_` literally. USERs always stay scoped to their own tickets, ignoring `createdBy`. Enum sorting follows LOW/MEDIUM/HIGH/URGENT and OPEN/IN_PROGRESS/RESOLVED/CLOSED, with UUID tie-breaking.

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

Users use `page`, `limit` (default 20, max 100) and optional name/email `search`; comments use `page`, `limit` (default 50, max 100). Both retain the nested response `{ "data": { "data": [], "page": 1, "limit": 20, "total": 0 } }` (comments default to 50).

OpenAPI is generated from the request validators and registered public response schemas. Tests compare registered Express routes against the specification and the Bruno collection. Swagger assets are documented under `/docs/{assetPath}`; HEAD and CORS preflights are implicit middleware behavior.

## curl examples

Run these against the development server (production cookies require HTTPS). Use one cookie jar for rotation; never reuse an old refresh cookie. The password prompt keeps the password out of shell history; `jq` constructs valid JSON without printing it.

```sh
BASE=http://localhost:3000
COOKIE_JAR=$(mktemp)
read -r -p 'Email: ' EMAIL
read -r -s -p 'Password (10–128 characters): ' PASSWORD
printf '\n'

# Register (or use the login request below for an existing account).
jq -n --arg email "$EMAIL" --arg password "$PASSWORD" \
  '{name:"Local User",email:$email,password:$password}' |
  curl --fail-with-body -sS -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
    --data-binary @- "$BASE/api/v1/auth/register"

jq -n --arg email "$EMAIL" --arg password "$PASSWORD" \
  '{email:$email,password:$password}' |
  curl --fail-with-body -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
    --data-binary @- "$BASE/api/v1/auth/login"
unset PASSWORD

curl --fail-with-body -sS -b "$COOKIE_JAR" "$BASE/api/v1/users/me"
TICKET_ID=$(curl --fail-with-body -sS -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -d '{"title":"Cannot access portal","description":"Sign-in page fails"}' \
  "$BASE/api/v1/tickets" | jq -r '.data.id')

curl --fail-with-body -sS -b "$COOKIE_JAR" \
  "$BASE/api/v1/tickets?page=1&pageSize=20&status=OPEN&q=portal&sort=createdAt&order=desc"
curl --fail-with-body -sS -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -d '{"body":"Still happening after a restart"}' \
  "$BASE/api/v1/tickets/$TICKET_ID/comments"
curl --fail-with-body -sS -X POST -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'X-CSRF-Protection: 1' "$BASE/api/v1/auth/refresh"
curl --fail-with-body -sS -X POST -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'X-CSRF-Protection: 1' "$BASE/api/v1/auth/logout"
rm -f "$COOKIE_JAR"
```

## Bruno collection

Open [docs/api-collection](docs/api-collection) as a collection in Bruno, select **Local**, and follow its [instructions](docs/api-collection/README.md). It includes every documented operation, cookie-based authentication, CSRF headers, response assertions and captured resource IDs. Credentials are supplied locally; none are committed. Run it only against disposable local data: the admin requests change roles and delete the sample ticket.

## Testing

```sh
npm run typecheck && npm run lint && npm test && npm run test:integration
npm run test:coverage
```

The last verified baseline is **176 tests (86 unit, 90 integration)** and **95.19% line coverage (about 95%)**. The earlier 85/91 split does not match the current test configuration. Counts and timings can change as tests are added.

Integration tests run serially and truncate comments, refresh sessions, tickets and users before and after each test. `TEST_DATABASE_URL` must identify a separate database whose name contains `test`; never use a database containing data to keep. Setup preserves migration metadata and closes pools. Shared `createUser`, `loginAs` and `createTicket` helpers recreate fixtures; auth endpoint tests still exercise HTTP directly.

Coverage runs both projects and enforces **80% global line coverage**. It includes `src/db/seed.ts` and `src/lib/shutdown.ts`; exclusions are tests/helpers, declarations and the thin `server.ts`, `db/migrate.ts`, `db/migrate-test.ts` entrypoints. Reports are in `coverage/` (HTML, JSON summary and terminal table). CI provisions PostgreSQL, migrates `triage_test`, runs lint/typecheck/unit tests and combined coverage, then builds. High-severity dependency audit is non-blocking.

## Security notes

- Argon2id password hashing, lowercase email uniqueness and identical login errors for unknown email/wrong password.
- Refresh tokens stored only as SHA-256 hashes; signature/type/issuer/audience/expiry validation, rotation and reuse detection.
- Current database user/role loaded for every protected request; deleted users get 401 and demotions apply immediately.
- HttpOnly cookies, Secure in production, deliberate SameSite=Strict; custom CSRF header and explicit CORS allowlist with no wildcards.
- Shared login/register/refresh limit of 10 attempts per IP per 15 minutes; general 300/minute limit. Liveness/readiness bypass rate limiting.
- Strict JSON parsing capped at 16 KB, Zod input validation, parameterized queries and database constraints.
- Helmet CSP relaxed only for `/docs`; docs/spec default off in production. Errors contain no stack traces; logs omit credentials, cookies, bodies and query strings.
- Non-root container, production dependencies only, no `.env` in the image. Use HTTPS and configure trusted proxy hops deliberately.

See [SECURITY.md](SECURITY.md) for controls and known limitations. Refresh-session revocation does not invalidate already issued access JWTs; they remain usable until expiry for existing accounts.

## Docker usage and image size

The Dockerfile has `deps → build → runtime` stages on Node 24 Debian slim. The runtime contains compiled JavaScript, production dependencies and migrations. It runs as the non-root `node` user, starts Node directly and checks `/health` with Node fetch. `.dockerignore` excludes `.env`, `.env.*`, local dependencies, tests and coverage from the build context.

```sh
# Only Postgres (usual local development).
docker compose up -d postgres

# API + healthy Postgres + one-shot migration job.
docker compose --profile full up --build -d

docker compose --profile full logs api migrate
docker image inspect triage-api:local --format '{{.Size}}'
```

Set strong distinct JWT secrets before using profile `full`. It fixes `NODE_ENV=production` and container port 3000; `PORT` chooses the host port. The migration job waits for healthy Postgres, and API startup waits for successful migration completion. Both read configuration through Compose environment interpolation; no `.env` is copied into the image. `ENABLE_DOCS` defaults to false.

Container `DATABASE_URL` uses `postgres:5432`, independently of the host URL/port. For URL-reserved credential characters, set a fully percent-encoded `CONTAINER_DATABASE_URL` consistent with `POSTGRES_*`. Named database volumes persist. For cookie-authenticated production-mode testing, use an HTTPS reverse proxy; a previously obtained Bearer access JWT can authenticate protected calls over local HTTP, but unsafe calls still need the CSRF header.

| Image measurement          | Uncompressed local size                      |
| -------------------------- | -------------------------------------------- |
| Before multi-stage runtime | Not recorded; no verified baseline available |
| After multi-stage runtime  | **394,312,137 bytes = 376.05 MiB**           |

The after value is the previously built `triage-api:local` image, before the seed-test refactor and this documentation change; it was not rebuilt for this task. No reduction percentage can be claimed without a before measurement. Registry download size differs; architecture and base-image updates affect future builds.

## Decisions and trade-offs

- **Database-backed authorization:** one indexed user lookup per authenticated request buys immediate demotion/deletion enforcement, at the cost of latency and a database dependency. Token role claims are not trusted.
- **Cookies and CSRF:** HttpOnly cookies reduce script access to tokens; SameSite=Strict favors same-site browser clients. A fixed custom header relies on trusted CORS origins and preflights and does not prevent XSS. Tokens are never returned in JSON.
- **Refresh revocation:** rotation and user-row locking detect replay across devices. Clients must serialize refresh attempts; access JWTs remain valid until expiry after logout/reuse detection.
- **Database integrity:** unique `lower(email)` indexing and CHECK constraints protect direct SQL too. PostgreSQL triggers strictly advance `updated_at` on every UPDATE, including no-op updates. Triggers are maintained in new SQL migrations because Drizzle Kit does not model them.
- **Pagination:** offset pagination and stable UUID tie-breakers keep implementation straightforward. Deep pages may become costly; cursor pagination is a future option. Users/comments retain their older nested pagination envelope; tickets use `data` plus `meta`.
- **Rate limiting:** counters are stored in process memory, so limits reset on restart and are enforced per instance rather than globally. Running multiple replicas requires a shared store, for example Redis via `rate-limit-redis`. Adding a shared store is planned for when the app is scaled out.
- **Deployment:** a Debian slim image supports native Argon2 with a simple runtime; it trades image size for compatibility. One-shot Compose migrations suit a single deployment host; coordinated releases across replicas need an explicit migration strategy.
- **Shutdown and tests:** shutdown logic is independently tested with fake timers; the server entrypoint only wires dependencies. Production seed refusal has instant pure-function coverage plus one real Node/tsx subprocess smoke test with a test-only 30-second timeout.
