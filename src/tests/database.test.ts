import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../app.js";
import { db, pool } from "../db/client.js";
import { tickets, users } from "../db/schema.js";

describe("triage-api database flows", () => {
  const api = request.agent(app);
  const email = `api-test-${crypto.randomUUID()}@example.test`;
  let userId: string;
  let ticketId: string;
  let registrationCookies: string[] = [];

  beforeAll(async () => {
    const response = await api.post("/api/auth/register").send({
      name: "API Test User",
      email,
      password: "correct horse battery staple",
    });
    expect(response.status).toBe(201);
    const setCookie = response.headers["set-cookie"];
    registrationCookies = Array.isArray(setCookie)
      ? setCookie
      : setCookie
        ? [setCookie]
        : [];
    userId = response.body.data.id as string;
  });

  afterAll(async () => {
    if (ticketId) await db.delete(tickets).where(eq(tickets.id, ticketId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  it("keeps credentials out of responses and supports ticket comments", async () => {
    const currentUser = await api.get("/api/users/me");
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.data).not.toHaveProperty("passwordHash");
    expect(currentUser.body.data).not.toHaveProperty("accessToken");
    expect(currentUser.body.data).not.toHaveProperty("refreshToken");
    expect(registrationCookies).toEqual(
      expect.arrayContaining([expect.stringContaining("HttpOnly")]),
    );

    const created = await api.post("/api/tickets").send({
      title: "Cannot access student portal",
      description: "The portal returns an error after sign in.",
      priority: "HIGH",
    });
    expect(created.status).toBe(201);
    ticketId = created.body.data.id as string;

    const forbiddenUpdate = await api.patch(`/api/tickets/${ticketId}`).send({
      status: "RESOLVED",
    });
    expect(forbiddenUpdate.status).toBe(403);

    const comment = await api
      .post(`/api/tickets/${ticketId}/comments`)
      .send({ body: "I can provide a screenshot." });
    expect(comment.status).toBe(201);

    const comments = await api.get(`/api/tickets/${ticketId}/comments`);
    expect(comments.status).toBe(200);
    expect(comments.body.data.total).toBe(1);
    expect(comments.body.data.data[0].author.id).toBe(userId);
  });
});
