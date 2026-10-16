# triage-api

The API base URL is `/api/v1`. OpenAPI paths are relative to that server URL.

| Router   | Endpoints                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth     | `POST /api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`                                                        |
| Users    | `GET /api/v1/users/me`, `GET /api/v1/users`, `PATCH /api/v1/users/{userId}/role`                                                                         |
| Tickets  | `GET /api/v1/tickets`, `POST /api/v1/tickets`, `GET /api/v1/tickets/{ticketId}`, `PATCH /api/v1/tickets/{ticketId}`, `DELETE /api/v1/tickets/{ticketId}` |
| Comments | `GET /api/v1/tickets/{ticketId}/comments`, `POST /api/v1/tickets/{ticketId}/comments`                                                                    |

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
