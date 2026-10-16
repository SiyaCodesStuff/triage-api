import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../app.js";
import { db, pool } from "../db/client.js";
import { register, login } from "../modules/auth/service.js";
import { tickets, users } from "../db/schema.js";

describe("triage-api database flows", () => {
  const api = request.agent(app);
  const email = `api-test-${crypto.randomUUID()}@example.test`;
  let userId: string;
  let ticketId: string;
  let registrationCookies: string[] = [];

  beforeAll(async () => {
    const response = await api.post("/api/v1/auth/register").send({
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

  it("normalises service emails and rejects mixed-case duplicates through the API and database", async () => {
    const mixedEmail = `Mixed-${crypto.randomUUID()}@Example.Test`;
    const registered = await register({
      name: "Case test",
      email: mixedEmail,
      password: "correct horse battery staple",
    });
    try {
      expect(registered.user.email).toBe(mixedEmail.toLowerCase());
      const signedIn = await login(
        mixedEmail.toUpperCase(),
        "correct horse battery staple",
      );
      expect(signedIn.user.id).toBe(registered.user.id);
      const duplicate = await request(app).post("/api/v1/auth/register").send({
        name: "Duplicate",
        email: mixedEmail.toUpperCase(),
        password: "correct horse battery staple",
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("CONFLICT");
      await expect(
        pool.query(
          `INSERT INTO users (name, email, password_hash)
         VALUES ('Duplicate', $1, 'unused-test-value')`,
          [mixedEmail.toUpperCase()],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "users_email_unique",
      });
    } finally {
      await db.delete(users).where(eq(users.id, registered.user.id));
    }
  });

  it.each([
    ["", "tickets_title_nonempty"],
    ["   ", "tickets_title_nonempty"],
    ["x".repeat(201), "tickets_title_length"],
  ])(
    "rejects invalid title %j at the database level",
    async (title, constraint) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await expect(
          client.query(
            "INSERT INTO tickets (title, description, created_by) VALUES ($1, 'test', $2)",
            [title, userId],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );

  it.each([
    ["", "comments_body_nonempty"],
    ["   ", "comments_body_nonempty"],
    ["x".repeat(5001), "comments_body_length"],
  ])(
    "rejects invalid comment body (case %#) at the database level",
    async (body, constraint) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ticket = await client.query<{ id: string }>(
          "INSERT INTO tickets (title, description, created_by) VALUES ('test', 'test', $1) RETURNING id",
          [userId],
        );
        await expect(
          client.query(
            "INSERT INTO comments (body, ticket_id, author_id) VALUES ($1, $2, $3)",
            [body, ticket.rows[0].id, userId],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );

  it("accepts maximum lengths, indexes ticket creation time, and advances every updated_at on direct SQL updates", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ticket = await client.query<{ id: string }>(
        "INSERT INTO tickets (title, description, created_by) VALUES ($1, 'test', $2) RETURNING id",
        ["x".repeat(200), userId],
      );
      const comment = await client.query<{ id: string }>(
        "INSERT INTO comments (body, ticket_id, author_id) VALUES ($1, $2, $3) RETURNING id",
        ["x".repeat(5000), ticket.rows[0].id, userId],
      );
      for (const [table, id] of [
        ["users", userId],
        ["tickets", ticket.rows[0].id],
        ["comments", comment.rows[0].id],
      ] as const) {
        // No-op updates must advance timestamps too, even within one transaction.
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await client.query<{
            advanced: boolean;
            created_unchanged: boolean;
          }>(
            `WITH previous AS MATERIALIZED (SELECT updated_at, created_at FROM ${table} WHERE id = $1),
             updated AS (UPDATE ${table} SET updated_at = updated_at WHERE id = $1 RETURNING updated_at, created_at)
             SELECT updated.updated_at > previous.updated_at AS advanced,
                    updated.created_at = previous.created_at AS created_unchanged
             FROM updated, previous`,
            [id],
          );
          expect(result.rows).toEqual([
            { advanced: true, created_unchanged: true },
          ]);
        }
      }
      const index = await client.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tickets_created_at_idx'",
      );
      expect(index.rows[0]?.indexdef).toContain("(created_at)");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps credentials out of responses and supports ticket comments", async () => {
    const refreshed = await api.post("/api/v1/auth/refresh").send({});
    expect(refreshed.status).toBe(200);

    const currentUser = await api.get("/api/v1/users/me");
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.data).not.toHaveProperty("passwordHash");
    expect(currentUser.body.data).not.toHaveProperty("accessToken");
    expect(currentUser.body.data).not.toHaveProperty("refreshToken");
    expect(registrationCookies).toEqual(
      expect.arrayContaining([expect.stringContaining("HttpOnly")]),
    );

    const created = await api.post("/api/v1/tickets").send({
      title: "Cannot access student portal",
      description: "The portal returns an error after sign in.",
      priority: "HIGH",
    });
    expect(created.status).toBe(201);
    ticketId = created.body.data.id as string;

    const forbiddenUpdate = await api
      .patch(`/api/v1/tickets/${ticketId}`)
      .send({
        status: "RESOLVED",
      });
    expect(forbiddenUpdate.status).toBe(403);

    const comment = await api
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .send({ body: "I can provide a screenshot." });
    expect(comment.status).toBe(201);

    const comments = await api.get(`/api/v1/tickets/${ticketId}/comments`);
    expect(comments.status).toBe(200);
    expect(comments.body.data.total).toBe(1);
    expect(comments.body.data.data[0].author.id).toBe(userId);

    const logout = await api.post("/api/v1/auth/logout").send({});
    expect(logout.status).toBe(204);
    const afterLogout = await api.get("/api/v1/users/me");
    expect(afterLogout.status).toBe(401);
  });
});
