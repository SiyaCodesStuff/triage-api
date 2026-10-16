import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import { z } from "../lib/zod.js";
import * as auth from "../modules/auth/schemas.js";
import * as users from "../modules/users/schemas.js";
import * as tickets from "../modules/tickets/schemas.js";
import * as comments from "../modules/comments/schemas.js";
import {
  commentResponseSchema,
  errorEnvelopeSchema,
  listedCommentSchema,
  noRequestDataSchema,
  publicUserSchema,
  ticketResponseSchema,
  validationDetailsSchema,
} from "./openapi-schemas.js";

const registry = new OpenAPIRegistry();
const user = registry.register("User", publicUserSchema);
const ticket = registry.register("Ticket", ticketResponseSchema);
const comment = registry.register("Comment", commentResponseSchema);
const listedComment = registry.register("ListedComment", listedCommentSchema);
registry.register("Error", errorEnvelopeSchema);
registry.register("ValidationDetails", validationDetailsSchema);
const userResponse = registry.register(
  "UserResponse",
  z.strictObject({ data: user }),
);
const ticketResponse = registry.register(
  "TicketResponse",
  z.strictObject({ data: ticket }),
);
const commentResponse = registry.register(
  "CommentResponse",
  z.strictObject({ data: comment }),
);
const userPage = registry.register(
  "UserPage",
  z.strictObject({
    data: z.strictObject({
      data: z.array(user),
      page: z.number().int().min(1),
      limit: z.number().int().min(1).max(100),
      total: z.number().int().min(0),
    }),
  }),
);
const ticketPage = registry.register(
  "TicketPage",
  z.strictObject({
    data: z.array(ticket),
    meta: z.strictObject({
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
      total: z.number().int().min(0),
      totalPages: z.number().int().min(0),
    }),
  }),
);
const commentPage = registry.register(
  "CommentPage",
  z.strictObject({
    data: z.strictObject({
      data: z.array(listedComment),
      page: z.number().int().min(1),
      limit: z.number().int().min(1).max(100),
      total: z.number().int().min(0),
    }),
  }),
);
const csrf = registry.registerComponent("parameters", "csrfProtection", {
  name: "X-CSRF-Protection",
  in: "header",
  required: true,
  description:
    "Required on every unsafe API request, including login/register. Fixed marker; not a secret. See docs/auth.md.",
  schema: { type: "string", enum: ["1"], default: "1" },
}).ref;
registry.registerComponent("securitySchemes", "accessCookie", {
  type: "apiKey",
  in: "cookie",
  name: "triage_access",
  description:
    "HttpOnly access JWT. The current database user/role determines authorization.",
});
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "Access JWT; current database role is loaded on every authenticated request.",
});
registry.registerComponent("securitySchemes", "refreshCookie", {
  type: "apiKey",
  in: "cookie",
  name: "triage_refresh",
  description:
    "HttpOnly rotating refresh JWT, scoped to /api/v1/auth. Reuse revokes all user refresh sessions.",
});
registry.registerComponent("securitySchemes", "csrfHeader", {
  type: "apiKey",
  in: "header",
  name: "X-CSRF-Protection",
  description:
    "Must equal 1. Custom-header CSRF protection relies on the explicit trusted CORS allowlist and SameSite=Strict cookies.",
});
const cookieHeaders = {
  "Set-Cookie": {
    description:
      "Two Set-Cookie headers set/clear triage_access (Path=/) and triage_refresh (Path=/api/v1/auth). HttpOnly; SameSite=Strict; Secure in production. Credentials never appear in the JSON body.",
    schema: { type: "string" as const },
  },
};
const json = (schema: z.ZodType, description: string): ResponseConfig => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  400: ["BAD_REQUEST", "VALIDATION_ERROR", "INVALID_JSON"],
  401: ["UNAUTHORIZED"],
  403: ["FORBIDDEN", "CSRF_REQUIRED"],
  404: ["NOT_FOUND"],
  409: ["CONFLICT"],
  413: ["PAYLOAD_TOO_LARGE"],
  429: ["RATE_LIMITED"],
  500: ["INTERNAL_SERVER_ERROR"],
  503: ["NOT_READY"],
} as const;
const errorResponses: Record<number, ResponseConfig> = {};
for (const [status, codes] of Object.entries(errors)) {
  const schema = registry.register(
    `Error${status}`,
    errorEnvelopeSchema.extend({
      error: z.strictObject({
        code: z.enum(codes),
        message: z.string(),
        details:
          status === "400"
            ? validationDetailsSchema.optional()
            : z.unknown().optional(),
      }),
    }),
  );
  errorResponses[Number(status)] = json(schema, codes.join(" / "));
}
errorResponses[429].headers = {
  "Retry-After": {
    schema: { type: "integer", minimum: 0 },
    description: "Seconds until retry",
  },
  RateLimit: {
    schema: { type: "string" },
    description: "draft-8 rate-limit state",
  },
  "RateLimit-Policy": {
    schema: { type: "string" },
    description:
      "Auth: 10 requests per IP per 900 seconds, shared across login/register/refresh; general: 300 per 60 seconds",
  },
};

type ApiOptions = {
  description: string;
  access?: "public" | "refresh" | "optionalRefresh";
  status?: number;
  errors?: number[];
  cookies?: boolean;
};
function api(
  method: RouteConfig["method"],
  path: string,
  operationId: string,
  schema: z.ZodObject,
  response: z.ZodType | undefined,
  options: ApiOptions,
) {
  const unsafe = !["get", "head", "options"].includes(method);
  const csrfSecurity: Record<string, string[]> = unsafe
    ? { csrfHeader: [] }
    : {};
  const security =
    options.access === "refresh"
      ? [{ refreshCookie: [], ...csrfSecurity }]
      : options.access === "public" || options.access === "optionalRefresh"
        ? [csrfSecurity]
        : [
            { accessCookie: [], ...csrfSecurity },
            { bearerAuth: [], ...csrfSecurity },
          ];
  const responses: RouteConfig["responses"] = {};
  for (const status of new Set([
    400,
    413,
    429,
    500,
    ...(options.access === undefined || options.access === "refresh"
      ? [401]
      : []),
    ...(unsafe ? [403] : []),
    ...(options.errors ?? []),
  ])) {
    responses[status] = errorResponses[status];
  }
  const status = options.status ?? 200;
  responses[status] = response
    ? json(response, options.description)
    : { description: "No content" };
  if (options.cookies) responses[status].headers = cookieHeaders;
  const body = registry.register(
    `${operationId}Body`,
    schema.shape.body as z.ZodType,
  );
  registry.registerPath({
    method,
    path,
    operationId,
    summary: operationId,
    description: options.description,
    security,
    ...(unsafe ? { parameters: [csrf] } : {}),
    request: {
      params: schema.shape.params as z.ZodObject,
      query: schema.shape.query as z.ZodObject,
      body: {
        required: !body.isOptional(),
        description:
          "Unknown fields are rejected. Empty optional bodies may be omitted.",
        content: { "application/json": { schema: body } },
      },
    },
    responses,
    "x-reject-unknown-query-parameters": true,
  });
}
api(
  "post",
  "/auth/register",
  "register",
  auth.registerRequestSchema,
  userResponse,
  {
    access: "public",
    status: 201,
    cookies: true,
    errors: [409],
    description:
      "Create a USER account. Email is lowercased; password 10–128 characters is hashed with Argon2id. Auth endpoints share 10 attempts per IP per 15 minutes.",
  },
);
api("post", "/auth/login", "login", auth.loginRequestSchema, userResponse, {
  access: "public",
  cookies: true,
  errors: [401],
  description:
    "Sign in. Unknown email and incorrect password return the identical 401 envelope.",
});
api(
  "post",
  "/auth/refresh",
  "refresh",
  auth.refreshRequestSchema,
  userResponse,
  {
    access: "refresh",
    cookies: true,
    description:
      "Rotate the refresh cookie. Reusing a revoked refresh token revokes every refresh session for that user; invalid, expired or reused tokens return 401.",
  },
);
api("post", "/auth/logout", "logout", auth.logoutRequestSchema, undefined, {
  access: "optionalRefresh",
  status: 204,
  cookies: true,
  description:
    "Revoke the presented refresh session if present and clear both cookies. No refresh cookie is required. Existing access JWTs remain usable until expiry for existing users.",
});
api(
  "get",
  "/users/me",
  "getCurrentUser",
  users.getMeRequestSchema,
  userResponse,
  {
    errors: [404],
    description:
      "Get the authenticated user's public profile. No password hashes or credentials are returned.",
  },
);
api("get", "/users", "listUsers", users.listUsersRequestSchema, userPage, {
  errors: [403],
  description:
    "ADMIN only. Paginated, case-insensitive literal substring search across name/email, ordered by name/id.",
});
api(
  "get",
  "/users/{userId}",
  "getUser",
  users.getUserRequestSchema,
  userResponse,
  {
    errors: [403, 404],
    description: "ADMIN only. Get a public user profile by UUID.",
  },
);
api(
  "patch",
  "/users/{userId}/role",
  "changeUserRole",
  users.changeRoleRequestSchema,
  userResponse,
  {
    errors: [404],
    description: "ADMIN only. Administrators cannot demote themselves.",
  },
);
api(
  "get",
  "/tickets",
  "listTickets",
  tickets.listTicketsRequestSchema,
  ticketPage,
  {
    description:
      "USERs always see only their own tickets; createdBy is ignored for USERs. Filters combine with AND; q matches title OR description as a case-insensitive literal substring. Priority sorts LOW/MEDIUM/HIGH/URGENT; status sorts OPEN/IN_PROGRESS/RESOLVED/CLOSED. UUID breaks ties in the chosen direction.",
  },
);
api(
  "post",
  "/tickets",
  "createTicket",
  tickets.createTicketRequestSchema,
  ticketResponse,
  {
    status: 201,
    description:
      "Create an OPEN ticket owned by the caller, initially unassigned.",
  },
);
api(
  "get",
  "/tickets/{ticketId}",
  "getTicket",
  tickets.getTicketRequestSchema,
  ticketResponse,
  {
    errors: [404],
    description:
      "Get a visible ticket. USERs requesting a foreign ticket receive 404; staff see all tickets.",
  },
);
api(
  "patch",
  "/tickets/{ticketId}",
  "updateTicket",
  tickets.updateTicketRequestSchema.extend({
    body: tickets.updateTicketRequestSchema.shape.body.openapi({
      minProperties: 1,
    }),
  }),
  ticketResponse,
  {
    errors: [404],
    description:
      "USERs edit only title/description of their own OPEN tickets. Staff can change priority/status and assign AGENT/ADMIN or clear assignment with null. Allowed transitions: OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED, plus RESOLVED -> OPEN. All other transitions, including unchanged status, return 400. At least one body field is required.",
  },
);
api(
  "delete",
  "/tickets/{ticketId}",
  "deleteTicket",
  tickets.deleteTicketRequestSchema,
  undefined,
  {
    status: 204,
    errors: [404],
    description: "ADMIN only. USERs requesting foreign tickets receive 404.",
  },
);
api(
  "get",
  "/tickets/{ticketId}/comments",
  "listComments",
  comments.listCommentsRequestSchema,
  commentPage,
  {
    errors: [404],
    description:
      "Visible tickets only. Oldest first, UUID ascending breaks timestamp ties. Existing comments on CLOSED tickets remain readable.",
  },
);
api(
  "post",
  "/tickets/{ticketId}/comments",
  "createComment",
  comments.createCommentRequestSchema,
  commentResponse,
  {
    status: 201,
    errors: [404, 409],
    description:
      "Visible tickets only. CLOSED tickets return 409 CONFLICT for all roles.",
  },
);
api(
  "delete",
  "/tickets/{ticketId}/comments/{commentId}",
  "deleteComment",
  comments.deleteCommentRequestSchema,
  undefined,
  {
    status: 204,
    errors: [404],
    description:
      "Ticket must be visible. Authors delete their own comments; ADMINs delete any. AGENTs have no override. Allowed on CLOSED tickets too. Wrong-ticket/missing comment ids return 404.",
  },
);

const operational = { servers: [{ url: "/" }], security: [] };
registry.registerPath({
  ...operational,
  method: "get",
  path: "/health",
  operationId: "health",
  summary: "Liveness (outside rate limit)",
  responses: {
    200: json(
      z.strictObject({ data: z.strictObject({ status: z.literal("ok") }) }),
      "Process is alive",
    ),
  },
});
registry.registerPath({
  ...operational,
  method: "get",
  path: "/ready",
  operationId: "ready",
  summary: "Database readiness (outside rate limit)",
  responses: {
    200: json(
      z.strictObject({ data: z.strictObject({ status: z.literal("ready") }) }),
      "Database is available",
    ),
    503: errorResponses[503],
  },
});
const openApiSchema = registry.register(
  "OpenApiDocument",
  z.object({
    openapi: z.literal("3.1.0"),
    info: z.object({
      title: z.string(),
      version: z.string(),
      description: z.string(),
    }),
    servers: z.array(z.object({ url: z.string() })),
    paths: z.record(z.string(), z.unknown()),
    components: z.record(z.string(), z.unknown()),
  }),
);
registry.registerPath({
  ...operational,
  method: "get",
  path: "/openapi.json",
  operationId: "openApi",
  summary: "Generated OpenAPI (ENABLE_DOCS only)",
  request: {
    query: noRequestDataSchema.shape.query,
    body: {
      required: false,
      content: {
        "application/json": { schema: noRequestDataSchema.shape.body },
      },
    },
  },
  responses: {
    200: json(openApiSchema, "Generated specification"),
    400: errorResponses[400],
    404: errorResponses[404],
    413: errorResponses[413],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});
registry.registerPath({
  ...operational,
  method: "get",
  path: "/docs",
  operationId: "swaggerUi",
  summary: "Swagger UI (ENABLE_DOCS only)",
  responses: {
    200: {
      description: "Swagger HTML",
      content: { "text/html": { schema: z.string() } },
    },
    301: {
      description: "Redirect to /docs/",
      headers: { Location: { schema: { type: "string" } } },
    },
    404: errorResponses[404],
    429: errorResponses[429],
    413: errorResponses[413],
    400: errorResponses[400],
    500: errorResponses[500],
  },
});
registry.registerPath({
  ...operational,
  method: "get",
  path: "/docs/{assetPath}",
  operationId: "swaggerAsset",
  summary: "Swagger UI assets (ENABLE_DOCS only)",
  request: { params: z.object({ assetPath: z.string() }) },
  responses: {
    200: {
      description: "Swagger static assets",
      content: {
        "text/css": { schema: z.string() },
        "application/javascript": { schema: z.string() },
        "image/png": { schema: { type: "string", format: "binary" } },
      },
    },
    404: errorResponses[404],
    429: errorResponses[429],
    413: errorResponses[413],
    400: errorResponses[400],
    500: errorResponses[500],
  },
});
const generated = new OpenApiGeneratorV31(
  registry.definitions,
).generateDocument({
  openapi: "3.1.0",
  info: {
    title: "triage-api",
    version: "1.0.0",
    description:
      "Support ticket API. Business endpoints use /api/v1; operational endpoints override the server to /. Errors use {error:{code,message,details?}}. Unknown fields are rejected by strict request validators. HEAD is implicit for GET routes; browser CORS preflights are handled by middleware. Docs default off in production.",
  },
  servers: [{ url: "/api/v1" }],
});
export const openApiDocument = {
  ...generated,
  paths: generated.paths ?? {},
  components: generated.components ?? {},
};
