# Authentication

Use `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`, and `GET /api/v1/users/me`. Registration accepts name, email and a password of 10–128 characters. Passwords use Argon2id; emails are lowercased and unique without regard to case. Login accepts email/password and returns the same 401 envelope for unknown accounts and incorrect passwords, performing Argon2 verification in both cases.

Successful register/login/refresh responses contain only the public user in `{ "data": ... }`. Credentials are HttpOnly cookies: `triage_access` at `/` and `triage_refresh` at `/api/v1/auth`. Both use `Secure` in production and `SameSite=Strict` deliberately: browser clients must run on the same site to use cookie authentication. Production requires HTTPS. GET /users/me also accepts `Authorization: Bearer <access credential>`; absent or invalid credentials return 401.

## CSRF

Every POST/PATCH/PUT/DELETE (and other unsafe method) under `/api/v1` requires `X-CSRF-Protection: 1`, including register and login to prevent login CSRF. Missing or incorrect headers return 403 `CSRF_REQUIRED` before any action. This is a custom-header approach: HTML forms cannot send this header, and cross-origin JavaScript must pass a CORS preflight. The server allows credentialed CORS only for the explicit `CORS_ORIGINS` list (disabled by default). Configure only fully trusted origins; never reflect arbitrary origins or use a wildcard. SameSite=Strict is an additional cookie boundary. The header is a fixed marker, not a secret or synchronizer token. Non-browser clients must send it too, even with Bearer authentication.

For browser calls use `credentials: "include"` and `headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" }`. A legitimate same-origin script can set the header; this approach does not protect against XSS.

## Refresh lifecycle

Refresh credentials are signed, expiring JWTs. Only their SHA-256 hex digests are stored in `refresh_sessions`; raw credentials are never stored there. Refresh validates signature, issuer, audience, type and expiry, revokes the current session, and issues a fresh pair. Refresh operations lock the user row so concurrent rotations/replays cannot leave a surviving refresh session after reuse detection. Clients should serialize refresh attempts.

Presenting a previously revoked, still cryptographically valid refresh credential revokes **all** refresh sessions for that user, including other devices. The revocation commits before returning 401. Unknown, expired or tampered credentials return 401. Logout revokes the presented refresh session and clears both cookies; repeating logout is safe. Existing access JWTs remain valid until their short expiry, including after logout or reuse detection; session revocation prevents further refresh, not already issued access JWT use.

## Current database authorization

After verifying an access JWT, `authenticate` uses its `sub` only to load the current user's id and role from the database and sets `req.user = { id, role }`. Role claims in JWTs are not used for authorization. Every protected route, including comments, uses this current database identity. Demotions apply on the next request with the same still-valid token; a deleted user receives 401 in the standard error envelope.

This deliberately adds one indexed user lookup per authenticated request. The extra query and database dependency trade a small amount of latency for immediate role/deletion enforcement; there is no role cache. Endpoint-specific queries, such as fetching the public profile for `/users/me`, still run separately. Logout/session revocation semantics above are unchanged for users who still exist.
