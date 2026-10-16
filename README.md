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
