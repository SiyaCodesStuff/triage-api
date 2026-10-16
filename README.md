# triage-api

The API base URL is `/api/v1`. OpenAPI paths are relative to that server URL.

| Router   | Endpoints                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth     | `POST /api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`                                                        |
| Users    | `GET /api/v1/users/me`, `GET /api/v1/users/{userId}`, `GET /api/v1/users`, `PATCH /api/v1/users/{userId}/role`                                           |
| Tickets  | `GET /api/v1/tickets`, `POST /api/v1/tickets`, `GET /api/v1/tickets/{ticketId}`, `PATCH /api/v1/tickets/{ticketId}`, `DELETE /api/v1/tickets/{ticketId}` |
| Comments | `GET /api/v1/tickets/{ticketId}/comments`, `POST /api/v1/tickets/{ticketId}/comments`, `DELETE /api/v1/tickets/{ticketId}/comments/{commentId}`          |

The previous `/api` routes are no longer mounted. Clients must use `/api/v1`.
Refresh cookies are scoped to `/api/v1/auth`; sign in again after upgrading to obtain cookies at the new path.

Operational endpoints remain unversioned: `GET /health`, `GET /ready`, `/docs` (Swagger UI), and `GET /openapi.json`.

Run validation with:

```sh
npm run typecheck && npm run lint && npm test && npm run test:integration
```

Integration tests require `TEST_DATABASE_URL` pointing to an available, migrated test PostgreSQL database.

Database integrity is enforced by migration `0001_database_integrity`: a unique index on `lower(users.email)`, ticket title and comment body checks, and an index on `tickets.created_at`. Titles must contain a non-space character after trimming and be at most 200 characters; comment bodies must contain a non-space character and be at most 5000 characters. Register and login normalise emails to lowercase; login also supports existing mixed-case stored addresses.

`updated_at` is maintained by PostgreSQL `BEFORE UPDATE` triggers on users, tickets and comments. This covers Drizzle and direct SQL, including no-op updates. Each update uses the later of the database clock or the previous timestamp plus one microsecond, so timestamps strictly advance. Trigger SQL is maintained in the migration because Drizzle Kit does not model triggers.

Before applying the migration, resolve existing case-insensitive duplicate emails or rows violating the new checks. The migration fails rather than deleting or rewriting such data. Apply to the test database before running integration tests:

```sh
npm run db:migrate:test
```

Apply to the application database when ready with `npm run db:migrate`.

Authentication and the required CSRF header are described in [docs/auth.md](docs/auth.md).

## User administration

`GET /api/v1/users`, `GET /api/v1/users/{userId}` and `PATCH /api/v1/users/{userId}/role` require a current ADMIN role in the database. USER and AGENT receive 403. Administrators cannot demote themselves. Responses contain public user fields only. `GET /api/v1/users/me` remains available to every authenticated role.

List users with `?page=1&limit=20&search=alice`. Search is an optional case-insensitive literal substring of name or email; pagination uses stable name/id ordering, limit 1–100, and returns `{ "data": { "data": [], "page": 1, "limit": 20, "total": 0 } }` with a filtered total.

## Seed an administrator

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the process environment (password: 10–128 characters), then run `npm run db:seed` against an already migrated database. No seed credentials are required for normal server startup. The command lowercases the email, hashes the password with Argon2id, and creates an ADMIN named Administrator. Repeated or concurrent runs for the same address preserve the existing admin and password. An existing non-admin account causes failure; it is never silently promoted.

Production seeding is refused unless explicitly invoked with `npm run db:seed -- --allow-production`. Seed output never includes credentials or database error parameters. No automatic seeding runs on server startup.

## Ticket permissions and lifecycle

Ticket endpoints check the current database role, so demotion immediately applies even when an older access JWT has not expired.

USERs create tickets owned by themselves, list/read only their own tickets, and edit only title/description while the ticket is OPEN. Requests for another user's ticket return 404, including PATCH and DELETE. USERs cannot change status, priority or assignment. AGENTs and ADMINs can list/read all tickets, change priority, and assign tickets to an AGENT or ADMIN (or clear assignment with null). Existing staff title/description editing remains available. Only ADMINs delete tickets.

Status changes by staff allow exactly `OPEN → IN_PROGRESS`, `IN_PROGRESS → RESOLVED`, `RESOLVED → CLOSED`, and `RESOLVED → OPEN`. All other requested transitions, including sending the current status again, return 400 `BAD_REQUEST`. USER field/status restrictions return 403. Updates lock the ticket row in a transaction so concurrent changes validate against its latest status, and rejected combined updates change no fields. State-changing requests require the CSRF header described above.

## Ticket listing

`GET /api/v1/tickets` accepts `page` (default 1), `pageSize` (default 20, range 1–100), `status`, `priority`, `assignedTo` (UUID), `createdBy` (UUID, staff only), `q`, `sort` (`createdAt`, `priority`, `status`) and `order` (`asc`, `desc`). Defaults are `createdAt` descending. Priority order is LOW, MEDIUM, HIGH, URGENT; status order is OPEN, IN_PROGRESS, RESOLVED, CLOSED. The ticket UUID breaks ties in the selected direction, making pagination stable. Invalid values return 400; the old `limit` parameter is no longer accepted.

Filters combine with AND. `q` is a case-insensitive literal substring of title OR description (trimmed, 1–200 characters; `%` and `_` are literal). USERs always receive only their own tickets, ignoring any supplied `createdBy`; all other filters can only narrow that scope. Staff can filter any creator. Example: `/api/v1/tickets?page=2&pageSize=10&status=OPEN&priority=HIGH&q=portal&sort=priority&order=desc`.

The response is `{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }`. Totals include all active filters and ownership restrictions. Empty matches have zero total pages; pages past the end return an empty data array while retaining the filtered totals. Other paginated endpoints retain their existing contracts.

## Comments

`POST /api/v1/tickets/{ticketId}/comments` accepts `{ "body": "..." }` (trimmed, 1–4000 characters). Users can create/read comments only on tickets visible to them: USERs on their own tickets, AGENTs/ADMINs on all tickets. Foreign tickets return 404 for USERs. CLOSED tickets reject new comments with 409 `CONFLICT` for every role, but existing comments remain readable and deletable. Creation locks the ticket row until the insert commits so closure and creation are serialized.

`GET /api/v1/tickets/{ticketId}/comments?page=1&limit=50` retains its existing response `{ "data": { "data": [], "page": 1, "limit": 50, "total": 0 } }`. Limit is 1–100. Results sort oldest first, then UUID ascending for tied timestamps; totals are scoped to the ticket.

`DELETE /api/v1/tickets/{ticketId}/comments/{commentId}` returns 204. The ticket must be visible and the caller must be the author or an ADMIN. Ticket ownership alone does not grant deletion of other authors' comments, and AGENTs have no deletion override. Non-authors receive 403; missing comments and comments belonging to a different ticket receive 404. Mutations require `X-CSRF-Protection: 1` as documented in [docs/auth.md](docs/auth.md).

## HTTP security configuration

`ENABLE_DOCS=true|false` controls Swagger UI and `/openapi.json`; default is off in production and on otherwise. Production CORS must use explicit trusted HTTP(S) origins in `CORS_ORIGINS`, never wildcards. Login/register/refresh share a 10-attempt limit per IP per 15 minutes. See [SECURITY.md](SECURITY.md) for controls and deployment trade-offs.
