import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadApp(
  options: {
    production?: boolean;
    docs?: string;
    trustProxy?: string;
    origins?: string;
  } = {},
) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", options.production ? "production" : "test");
  vi.stubEnv("ENABLE_DOCS", options.docs);
  vi.stubEnv("TRUST_PROXY", options.trustProxy ?? "0");
  vi.stubEnv("CORS_ORIGINS", options.origins);
  const { app } = await import("../app.js");
  const { logger } = await import("../config/logger.js");
  logger.level = "silent";
  return app;
}

describe("HTTP security controls", () => {
  it("shares ten auth attempts per fifteen minutes per IP across login/register/refresh", async () => {
    const app = await loadApp({ trustProxy: "1" });
    const paths = ["login", "register", "refresh"];
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .post(`/api/v1/auth/${paths[i % 3]}`)
        .set("X-CSRF-Protection", "1")
        .set("X-Forwarded-For", "192.0.2.10")
        .send({});
      expect(response.status).toBe(i % 3 === 2 ? 401 : 400);
    }
    for (const path of paths) {
      const response = await request(app)
        .post(`/api/v1/auth/${path}`)
        .set("X-CSRF-Protection", "1")
        .set("X-Forwarded-For", "192.0.2.10")
        .send({});
      expect(response.status).toBe(429);
      expect(response.body).toEqual({
        error: { code: "RATE_LIMITED", message: expect.any(String) },
      });
      expect(response.headers["retry-after"]).toBeDefined();
      expect(response.headers["ratelimit-policy"]).toContain("w=900");
    }
    const anotherIp = await request(app)
      .post("/api/v1/auth/login")
      .set("X-CSRF-Protection", "1")
      .set("X-Forwarded-For", "192.0.2.11")
      .send({});
    expect(anotherIp.status).toBe(400);
    expect((await request(app).get("/health")).status).toBe(200);
  }, 15000);

  it("does not let an untrusted forwarded IP bypass the limiter", async () => {
    const app = await loadApp();
    for (let i = 0; i < 11; i++) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("X-CSRF-Protection", "1")
        .set("X-Forwarded-For", `192.0.2.${i + 1}`)
        .send({});
      expect(response.status).toBe(i < 10 ? 400 : 429);
    }
  });

  it("returns the standard envelope for the general limiter and keeps health exempt", async () => {
    const app = await loadApp({ docs: "false" });
    for (let i = 0; i < 300; i++) {
      expect((await request(app).get("/openapi.json")).status).toBe(404);
    }
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
    expect((await request(app).get("/health")).status).toBe(200);
  }, 15000);

  it.each([false, true])(
    "disables UI, assets and specification with ENABLE_DOCS=false (production=%s)",
    async (production) => {
      const app = await loadApp({ production, docs: "false" });
      for (const path of [
        "/docs",
        "/docs/",
        "/docs/swagger-ui.js",
        "/openapi.json",
      ]) {
        const response = await request(app).get(path);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("NOT_FOUND");
      }
      expect((await request(app).get("/health")).status).toBe(200);
    },
  );

  it("defaults docs off in production and supports explicit opt-in", async () => {
    const disabled = await loadApp({ production: true });
    expect((await request(disabled).get("/docs/")).status).toBe(404);
    expect((await request(disabled).get("/openapi.json")).status).toBe(404);
    const enabled = await loadApp({ production: true, docs: "true" });
    expect((await request(enabled).get("/docs/")).status).toBe(200);
    expect((await request(enabled).get("/openapi.json")).status).toBe(200);
  });

  it("relaxes CSP only on Swagger UI, retaining strict CSP on API, health and OpenAPI", async () => {
    const app = await loadApp({ docs: "true" });
    const docs = await request(app).get("/docs/");
    expect(docs.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    for (const path of ["/health", "/openapi.json", "/api/v1/tickets"]) {
      const response = await request(app).get(path);
      expect(response.headers["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      expect(response.headers["content-security-policy"]).not.toContain(
        "'unsafe-inline'",
      );
    }
  });

  it("uses an exact production CORS allowlist for credentialed preflights", async () => {
    const app = await loadApp({
      production: true,
      origins: "https://trusted.example,https://second.example",
    });
    for (const origin of [
      "https://trusted.example",
      "https://second.example",
      "https://attacker.example",
      "null",
    ]) {
      const response = await request(app)
        .options("/api/v1/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set(
          "Access-Control-Request-Headers",
          "X-CSRF-Protection,Content-Type",
        );
      const allowed = [
        "https://trusted.example",
        "https://second.example",
      ].includes(origin);
      expect(response.headers["access-control-allow-origin"]).toBe(
        allowed ? origin : undefined,
      );
      if (allowed)
        expect(response.headers["access-control-allow-credentials"]).toBe(
          "true",
        );
    }
  });

  it.each(["*", "https://*.example.com"])(
    "rejects wildcard production CORS configuration %s",
    async (origins) => {
      await expect(loadApp({ production: true, origins })).rejects.toThrow(
        "CORS_ORIGINS",
      );
    },
  );

  it("retains the 16 KB JSON limit and standard parse error envelopes", async () => {
    const app = await loadApp();
    const oversized = await request(app)
      .post("/api/v1/auth/login")
      .set("X-CSRF-Protection", "1")
      .send({ email: "x".repeat(17 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    const invalid = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_JSON");
  });

  it("never exposes internal error messages or stack traces in production responses or logs raw errors", async () => {
    await loadApp({ production: true });
    const { errorHandler } = await import("../middleware/error-handler.js");
    const { logger } = await import("../config/logger.js");
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const app = express();
    app.get("/fail", () => {
      throw new Error("internal-only-diagnostic");
    });
    app.use(errorHandler);
    const response = await request(app).get("/fail");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
    });
    expect(log).toHaveBeenCalledWith(
      { errorName: "Error", method: "GET", path: "/fail" },
      "Unhandled request error",
    );
  });
});
