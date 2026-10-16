import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { openApiDocument } from "../config/openapi.js";
import { app } from "../app.js";
import { pool } from "../db/client.js";
import { clearAuthCookies, setAuthCookies } from "../lib/cookies.js";
import express from "express";

const accessToken = jwt.sign(
  { role: "USER", type: "access" },
  env.JWT_ACCESS_SECRET,
  {
    subject: "2a34a77e-b59b-4cba-8b0a-b28ae7b4f4e9",
    jwtid: "request-validation-test-token",
    issuer: "triage-api",
    audience: "triage-api-client",
    expiresIn: "5m",
  },
);

describe("triage-api request handling", () => {
  it("serves liveness and OpenAPI documentation", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe("ok");

    const docs = await request(app).get("/openapi.json");
    expect(docs.status).toBe(200);
    expect(docs.body.info.title).toBe("triage-api");

    const docsUi = await request(app).get("/docs/");
    expect(docsUi.status).toBe(200);
    expect(docsUi.text).toContain("swagger-ui");
  });

  it("publishes paths relative to the versioned OpenAPI server", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.body.servers).toEqual([{ url: "/api/v1" }]);
    expect(Object.keys(response.body.paths).sort()).toEqual(
      [
        "/auth/login",
        "/auth/logout",
        "/auth/refresh",
        "/auth/register",
        "/tickets",
        "/tickets/{ticketId}",
        "/tickets/{ticketId}/comments",
        "/users",
        "/users/me",
        "/users/{userId}/role",
      ].sort(),
    );
  });

  it("documents the CSRF header for every state-changing OpenAPI operation", () => {
    expect(openApiDocument.components.parameters.csrfProtection).toMatchObject({
      name: "X-CSRF-Protection",
      in: "header",
      required: true,
      schema: { enum: ["1"] },
    });
    for (const path of Object.values(openApiDocument.paths)) {
      for (const [method, operation] of Object.entries(path)) {
        if (["post", "patch", "delete", "put"].includes(method)) {
          expect(operation).toHaveProperty("parameters", [
            { $ref: "#/components/parameters/csrfProtection" },
          ]);
        }
      }
    }
  });

  it.each([
    "/users/me",
    "/tickets",
    "/tickets/2a34a77e-b59b-4cba-8b0a-b28ae7b4f4e9/comments",
  ])("mounts the protected router at /api/v1%s", async (path) => {
    const response = await request(app).get(`/api/v1${path}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it.each([
    ["get", "/api/users/me"],
    ["get", "/api/tickets"],
    ["get", "/api/tickets/example/comments"],
    ["post", "/api/auth/register"],
    ["get", "/api/v1/health"],
    ["get", "/api/v1/ready"],
    ["get", "/api/v1/docs"],
    ["get", "/api/v1/openapi.json"],
  ] as const)(
    "rejects the obsolete or versioned operational route %s %s",
    async (method, path) => {
      const response = await request(app)
        [method](path)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    },
  );

  it("keeps readiness unversioned", async () => {
    const query = vi
      .spyOn(pool, "query")
      .mockRejectedValueOnce(new Error("unavailable"));
    try {
      const response = await request(app).get("/ready");
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: {
          code: "NOT_READY",
          message: "The database is not available",
        },
      });
      expect(query).toHaveBeenCalledWith("SELECT 1");
    } finally {
      query.mockRestore();
    }
  });

  it("sets and clears refresh cookies at the versioned auth path", async () => {
    const cookieApp = express();
    cookieApp.post("/set", (_req, res) => {
      setAuthCookies(res, "test-access", "test-refresh");
      res.sendStatus(204);
    });
    cookieApp.post("/clear", (_req, res) => {
      clearAuthCookies(res);
      res.sendStatus(204);
    });
    for (const path of ["/set", "/clear"]) {
      const response = await request(cookieApp)
        .post(path)
        .set("X-CSRF-Protection", "1");
      const cookies = response.headers["set-cookie"] as unknown as string[];
      expect(
        cookies.find((cookie) => cookie.startsWith("triage_refresh=")),
      ).toContain("Path=/api/v1/auth;");
      expect(
        cookies.find((cookie) => cookie.startsWith("triage_access=")),
      ).toContain("Path=/;");
    }
  });

  it.each([
    "/auth/register",
    "/auth/login",
    "/auth/refresh",
    "/auth/logout",
    "/tickets",
  ])("rejects a missing CSRF header on POST %s", async (path) => {
    const response = await request(app).post(`/api/v1${path}`).send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_REQUIRED");
  });

  it("rejects missing credentials and passwords shorter than ten characters", async () => {
    expect((await request(app).get("/api/v1/users/me")).status).toBe(401);
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-CSRF-Protection", "1");
    expect(refresh.status).toBe(401);
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .set("X-CSRF-Protection", "1")
      .send({
        name: "Test",
        email: "test@example.test",
        password: "123456789",
      });
    expect(registration.status).toBe(400);
    expect(registration.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["access", "refresh"] as const)(
    "rejects expired and tampered %s credentials",
    async (type) => {
      const secret =
        type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
      const expired = jwt.sign({ role: "USER", type }, secret, {
        subject: "2a34a77e-b59b-4cba-8b0a-b28ae7b4f4e9",
        jwtid: "expired-test",
        issuer: "triage-api",
        audience: "triage-api-client",
        expiresIn: -1,
      });
      const tampered = jwt.sign(
        { role: "USER", type },
        "incorrect-signing-secret",
        {
          subject: "2a34a77e-b59b-4cba-8b0a-b28ae7b4f4e9",
          jwtid: "tampered-test",
          issuer: "triage-api",
          audience: "triage-api-client",
          expiresIn: "5m",
        },
      );
      for (const token of [expired, tampered]) {
        const response =
          type === "access"
            ? await request(app)
                .get("/api/v1/users/me")
                .set("Authorization", `Bearer ${token}`)
            : await request(app)
                .post("/api/v1/auth/refresh")
                .set("X-CSRF-Protection", "1")
                .set("Cookie", `triage_refresh=${token}`);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe("UNAUTHORIZED");
      }
    },
  );

  it("uses Secure, HttpOnly and SameSite=Strict for production cookies", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const {
        setAuthCookies: setProductionCookies,
        clearAuthCookies: clearProductionCookies,
      } = await import("../lib/cookies.js");
      const cookieApp = express();
      cookieApp.post("/set", (_req, res) => {
        setProductionCookies(res, "test-access", "test-refresh");
        res.sendStatus(204);
      });
      cookieApp.post("/clear", (_req, res) => {
        clearProductionCookies(res);
        res.sendStatus(204);
      });
      for (const path of ["/set", "/clear"]) {
        const response = await request(cookieApp).post(path);
        for (const cookie of response.headers[
          "set-cookie"
        ] as unknown as string[]) {
          expect(cookie.includes("Secure")).toBe(true);
          expect(cookie.includes("HttpOnly")).toBe(true);
          expect(cookie.includes("SameSite=Strict")).toBe(true);
        }
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("allows custom-header preflights only for configured CORS origins", async () => {
    vi.resetModules();
    vi.stubEnv("CORS_ORIGINS", "https://trusted.example");
    try {
      const { app: corsApp } = await import("../app.js");
      for (const origin of [
        "https://trusted.example",
        "https://attacker.example",
      ]) {
        const response = await request(corsApp)
          .options("/api/v1/auth/login")
          .set("Origin", origin)
          .set("Access-Control-Request-Method", "POST")
          .set(
            "Access-Control-Request-Headers",
            "X-CSRF-Protection,Content-Type",
          );
        expect(response.headers["access-control-allow-origin"] === origin).toBe(
          origin === "https://trusted.example",
        );
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("ignores query strings on the health route", async () => {
    const health = await request(app).get("/health?x=1");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ data: { status: "ok" } });
  });

  it("does not count health requests against the rate limit", async () => {
    const before = await request(app).get("/openapi.json");
    const health = await request(app).get("/health");
    const after = await request(app).get("/openapi.json");

    expect(health.status).toBe(200);
    expect(health.headers.ratelimit).toBeUndefined();
    const remaining = (header: string) => Number(/r=(\d+)/.exec(header)?.[1]);
    expect(remaining(before.headers.ratelimit)).toBeGreaterThan(0);
    expect(remaining(after.headers.ratelimit)).toBe(
      remaining(before.headers.ratelimit) - 1,
    );
  });

  it("returns consistent errors for missing auth and malformed request data", async () => {
    const unauthenticated = await request(app).get("/api/v1/tickets");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: expect.any(String),
    });

    const invalidRegistration = await request(app)
      .post("/api/v1/auth/register")
      .set("X-CSRF-Protection", "1")
      .send({
        name: "Bad User",
        email: "not-an-email",
        password: "short",
        role: "ADMIN",
      });
    expect(invalidRegistration.status).toBe(400);
    expect(invalidRegistration.body.error.code).toBe("VALIDATION_ERROR");

    const invalidQuery = await request(app)
      .get("/api/v1/tickets?unexpected=value")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(invalidQuery.status).toBe(400);

    const invalidParams = await request(app)
      .get("/api/v1/tickets/not-a-uuid")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(invalidParams.status).toBe(400);

    const invalidBody = await request(app)
      .post("/api/v1/tickets")
      .set("X-CSRF-Protection", "1")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "x", description: "", extra: true });
    expect(invalidBody.status).toBe(400);
  });
});

describe("proxy trust", () => {
  it.each([0, 1])(
    "honours X-Forwarded-For only when TRUST_PROXY is positive (%i)",
    async (trustProxy) => {
      vi.resetModules();
      vi.stubEnv("TRUST_PROXY", String(trustProxy));
      try {
        const { app: proxyApp } = await import("../app.js");
        expect(proxyApp.get("trust proxy")).toBe(trustProxy);

        const first = await request(proxyApp)
          .get("/openapi.json")
          .set("X-Forwarded-For", "192.0.2.1");
        const second = await request(proxyApp)
          .get("/openapi.json")
          .set("X-Forwarded-For", "192.0.2.2");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const remaining = (header: string) =>
          Number(/r=(\d+)/.exec(header)?.[1]);
        expect(remaining(first.headers.ratelimit)).toBe(299);
        expect(remaining(second.headers.ratelimit)).toBe(
          trustProxy > 0 ? 299 : 298,
        );
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    },
  );
});
