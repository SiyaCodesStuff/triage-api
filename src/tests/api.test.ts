import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { app } from "../app.js";

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

  it("returns consistent errors for missing auth and malformed request data", async () => {
    const unauthenticated = await request(app).get("/api/tickets");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: expect.any(String),
    });

    const invalidRegistration = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Bad User",
        email: "not-an-email",
        password: "short",
        role: "ADMIN",
      });
    expect(invalidRegistration.status).toBe(400);
    expect(invalidRegistration.body.error.code).toBe("VALIDATION_ERROR");

    const invalidQuery = await request(app)
      .get("/api/tickets?unexpected=value")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(invalidQuery.status).toBe(400);

    const invalidParams = await request(app)
      .get("/api/tickets/not-a-uuid")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(invalidParams.status).toBe(400);

    const invalidBody = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "x", description: "", extra: true });
    expect(invalidBody.status).toBe(400);
  });
});
