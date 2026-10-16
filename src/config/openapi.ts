export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "triage-api",
    version: "1.0.0",
    description: "REST API for support users, tickets, and ticket comments.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    parameters: {
      csrfProtection: {
        name: "X-CSRF-Protection",
        in: "header",
        required: true,
        description:
          "Required for all state-changing API requests (CSRF protection).",
        schema: { type: "string", enum: ["1"], default: "1" },
      },
    },
    securitySchemes: {
      accessCookie: { type: "apiKey", in: "cookie", name: "triage_access" },
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Create a USER account",
        responses: {
          "201": { description: "Account created" },
          "400": { description: "Invalid request" },
        },
      },
    },
    "/auth/login": {
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Sign in",
        responses: {
          "200": {
            description: "Signed in; credentials are set as HttpOnly cookies",
          },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Rotate the refresh credential",
        responses: {
          "200": { description: "Credentials rotated" },
          "401": { description: "Invalid refresh credential" },
        },
      },
    },
    "/auth/logout": {
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Revoke the current refresh session",
        responses: { "204": { description: "Session revoked" } },
      },
    },
    "/users/me": {
      get: {
        summary: "Get the current user",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Current user" } },
      },
    },
    "/users": {
      get: {
        summary: "List users (ADMIN)",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "search",
            in: "query",
            description: "Case-insensitive literal substring in name or email",
            schema: { type: "string", minLength: 1, maxLength: 254 },
          },
        ],
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "User page" } },
      },
    },
    "/users/{userId}": {
      get: {
        summary: "Get a user (ADMIN)",
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: {
          "200": { description: "Public user" },
          "403": { description: "Administrator access required" },
          "404": { description: "User not found" },
        },
      },
    },
    "/users/{userId}/role": {
      patch: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Change a user's role (ADMIN)",
        description:
          "Administrators cannot demote themselves. Requires a UUID userId and a body containing role (USER, AGENT or ADMIN).",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Updated user" } },
      },
    },
    "/tickets": {
      get: {
        summary: "List visible tickets",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Ticket page" } },
      },
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Create a ticket",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "201": { description: "Ticket created" } },
      },
    },
    "/tickets/{ticketId}": {
      get: {
        summary: "Get a ticket",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Ticket" } },
      },
      patch: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Update a ticket",
        description:
          "USER: own OPEN tickets, title/description only; foreign tickets return 404. AGENT/ADMIN: all tickets, status/priority and assignment to staff. Status transitions: OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED; RESOLVED -> OPEN also allowed. Other transitions, including unchanged status, return 400.",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Updated ticket" } },
      },
      delete: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Delete a ticket (ADMIN)",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "204": { description: "Ticket deleted" } },
      },
    },
    "/tickets/{ticketId}/comments": {
      get: {
        summary: "List ticket comments",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Comment page" } },
      },
      post: {
        parameters: [{ $ref: "#/components/parameters/csrfProtection" }],
        summary: "Add a ticket comment",
        security: [{ accessCookie: [] }, { bearerAuth: [] }],
        responses: { "201": { description: "Comment created" } },
      },
    },
  },
};
