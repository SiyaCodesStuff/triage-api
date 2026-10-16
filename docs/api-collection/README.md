# Bruno collection

Open this directory as a collection in Bruno and select **Local**. Start the development API with `ENABLE_DOCS=true`, migrate the database and seed an administrator first (see the root README).

The collection contains 23 requests covering all 21 documented method/path pairs, including unversioned probes, Swagger UI/assets and OpenAPI. Login and ticket update have separate user/admin examples. Request tests assert expected HTTP statuses and JSON success envelopes where applicable. Credentials are sent only to the API; scripts never print or persist tokens.

## Configure locally

Set `baseUrl` (default `http://localhost:3000`), `password` (10–128 characters), `adminEmail` and `adminPassword` in Bruno's Local environment. The admin credentials must match the seeded ADMIN. Use Bruno's local secret variables for passwords; leave the committed environment values empty. Do not save real credentials or exported cookie jars into this repository.

Keep Bruno's cookie jar enabled. Cookies from register/login/refresh are carried automatically; `auth: none` means no Authorization header is added, not that cookies are disabled. Production uses Secure cookies and requires an HTTPS base URL. This collection uses cookies rather than extracting credentials into variables.

Run the collection in its numbered order, serially, without parallel requests:

1. Probe health/readiness and documentation (docs requests expect 200; enabling docs is required).
2. Register a USER with a generated unique email, login, rotate cookies and read the profile.
3. Create/list/read/edit a ticket; create/list/delete a comment.
4. Login as the seeded ADMIN, list/read users and promote the sample user to AGENT.
5. Assign and move the sample ticket to IN_PROGRESS, delete it and logout.

The generated email and captured `userId`, `adminId`, `ticketId` and `commentId` are in-memory runtime variables. To run individual requests, first run their prerequisites in the same session or set those IDs locally. Resource IDs are not credentials. Requests do not log secrets; Bruno itself displays request/cookie data, so avoid sharing raw exports.

Each full run makes four requests against the shared 10-per-15-minute auth budget (register, user login, refresh, admin login). Repeated runs can receive 429; wait for the rate window or restart the development server, which resets its in-memory counters. Do not change the production limit for this collection.

Only run against disposable development data. The run leaves a sample AGENT account and the original user's refresh session in the database; deleting the sample ticket cascades its comments. Logout clears the current admin session. To remove all fixtures, recreate your disposable database and rerun migrations/seed. Do not run integration tests concurrently with the collection because they truncate tables.

## Endpoint details

All unsafe requests include `X-CSRF-Protection: 1`. Bodies use the current strict validators. Ticket filtering demonstrates combined status/priority/text filters and sorting; `assignedTo` and staff-only `createdBy` can be added as UUID query values. Users/comments use `limit`; tickets use `pageSize`. The complete schemas, errors and security schemes remain in `/openapi.json`.

Expected permission failures and lifecycle edge cases are covered by the automated integration suite. This collection provides successful examples of every endpoint. `05-swagger-asset.bru` uses `assetPath=swagger-ui.css` to exercise the documented `/docs/{assetPath}` operation.

Runtime ID capture uses [Bruno's documented `bru.setVar` API](https://github.com/usebruno/bruno-docs/blob/main/testing/script/javascript-reference.mdx); credentials and cookies are never written by the collection scripts.
