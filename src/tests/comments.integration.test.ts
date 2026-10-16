import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq, inArray } from "drizzle-orm";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { db, pool } from "../db/client.js";
import {
  comments,
  tickets,
  users,
  type Role,
  type TicketStatus,
} from "../db/schema.js";

describe("comment access and lifecycle", () => {
  const accounts = {} as Record<
    "USER" | "OTHER" | "AGENT" | "ADMIN",
    { id: string; token: string }
  >;
  const userIds: string[] = [];
  const ticketIds: string[] = [];
  beforeAll(async () => {
    for (const key of ["USER", "OTHER", "AGENT", "ADMIN"] as const) {
      const id = crypto.randomUUID();
      const role: Role = key === "OTHER" ? "USER" : key;
      await db
        .insert(users)
        .values({
          id,
          name: `Comment test ${key}`,
          email: `${id}@example.test`,
          passwordHash: "unused-test-value",
          role,
        });
      userIds.push(id);
      accounts[key] = {
        id,
        token: jwt.sign({ role, type: "access" }, env.JWT_ACCESS_SECRET, {
          subject: id,
          jwtid: crypto.randomUUID(),
          issuer: "triage-api",
          audience: "triage-api-client",
          expiresIn: "5m",
        }),
      };
    }
  });
  afterAll(async () => {
    try {
      if (ticketIds.length)
        await db.delete(tickets).where(inArray(tickets.id, ticketIds));
      if (userIds.length)
        await db.delete(users).where(inArray(users.id, userIds));
    } finally {
      await pool.end();
    }
  });
  async function ticket(status: TicketStatus = "OPEN") {
    const [row] = await db
      .insert(tickets)
      .values({
        title: "Comment test ticket",
        description: "Test",
        createdBy: accounts.USER.id,
        status,
      })
      .returning();
    ticketIds.push(row.id);
    return row.id;
  }
  function create(
    ticketId: string,
    role: keyof typeof accounts,
    body: object = { body: "A comment" },
  ) {
    return request(app)
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set("Authorization", `Bearer ${accounts[role].token}`)
      .set("X-CSRF-Protection", "1")
      .send(body);
  }
  function remove(
    ticketId: string,
    commentId: string,
    role: keyof typeof accounts,
  ) {
    return request(app)
      .delete(`/api/v1/tickets/${ticketId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${accounts[role].token}`)
      .set("X-CSRF-Protection", "1");
  }

  it.each(["USER", "AGENT", "ADMIN"] as const)(
    "%s can create/read comments on visible tickets without exposing credentials",
    async (role) => {
      const id = await ticket();
      const created = await create(id, role);
      expect(created.status).toBe(201);
      expect(Object.keys(created.body.data).sort()).toEqual(
        ["id", "ticketId", "body", "createdAt", "updatedAt"].sort(),
      );
      const [stored] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, created.body.data.id));
      expect(stored.authorId).toBe(accounts[role].id);
      const listed = await request(app)
        .get(`/api/v1/tickets/${id}/comments`)
        .set("Authorization", `Bearer ${accounts[role].token}`);
      expect(listed.status).toBe(200);
      expect(listed.body.data.total).toBe(1);
      expect(listed.body.data.data[0].author).toEqual({
        id: accounts[role].id,
        name: `Comment test ${role}`,
        role,
      });
    },
  );

  it("hides foreign tickets from USERs for GET, POST and DELETE with identical missing-ticket errors", async () => {
    const id = await ticket("CLOSED");
    const [comment] = await db
      .insert(comments)
      .values({ ticketId: id, authorId: accounts.USER.id, body: "Existing" })
      .returning();
    for (const method of ["get", "post", "delete"] as const) {
      const bodies = [];
      for (const ticketId of [id, crypto.randomUUID()]) {
        const path = `/api/v1/tickets/${ticketId}/comments${method === "delete" ? `/${comment.id}` : ""}`;
        const call = request(app)
          [method](path)
          .set("Authorization", `Bearer ${accounts.OTHER.token}`)
          .set("X-CSRF-Protection", "1");
        const response = await (method === "post"
          ? call.send({ body: "Hidden ticket" })
          : call);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("NOT_FOUND");
        bodies.push(response.body);
      }
      expect(bodies[0]).toEqual(bodies[1]);
    }
  });

  it.each(["USER", "AGENT", "ADMIN"] as const)(
    "rejects %s comments on CLOSED tickets with 409, but allows reading/deleting",
    async (role) => {
      const id = await ticket("CLOSED");
      const [comment] = await db
        .insert(comments)
        .values({
          ticketId: id,
          authorId: accounts[role].id,
          body: "Before closure",
        })
        .returning();
      const response = await create(id, role);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");
      expect(
        await db.select().from(comments).where(eq(comments.ticketId, id)),
      ).toHaveLength(1);
      expect(
        (
          await request(app)
            .get(`/api/v1/tickets/${id}/comments`)
            .set("Authorization", `Bearer ${accounts[role].token}`)
        ).status,
      ).toBe(200);
      expect((await remove(id, comment.id, role)).status).toBe(204);
    },
  );

  it.each(["OPEN", "IN_PROGRESS", "RESOLVED"] as const)(
    "allows commenting while %s",
    async (status) => {
      expect((await create(await ticket(status), "USER")).status).toBe(201);
    },
  );

  it.each(["USER", "AGENT", "ADMIN"] as const)(
    "lets %s delete their own comment",
    async (role) => {
      const id = await ticket();
      const created = await create(id, role);
      const removed = await remove(id, created.body.data.id, role);
      expect(removed.status).toBe(204);
      expect(removed.text).toBe("");
      expect(
        await db
          .select()
          .from(comments)
          .where(eq(comments.id, created.body.data.id)),
      ).toHaveLength(0);
      expect((await remove(id, created.body.data.id, role)).status).toBe(404);
    },
  );

  it("denies non-authors (including AGENT and ticket owner) and allows ADMIN to delete any author", async () => {
    const id = await ticket();
    const [comment] = await db
      .insert(comments)
      .values({ ticketId: id, authorId: accounts.ADMIN.id, body: "Staff note" })
      .returning();
    for (const role of ["USER", "AGENT"] as const) {
      const response = await remove(id, comment.id, role);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
    const authored = await create(id, "USER");
    expect((await remove(id, authored.body.data.id, "ADMIN")).status).toBe(204);
    expect((await remove(id, comment.id, "ADMIN")).status).toBe(204);
  });

  it("cannot delete a comment through the wrong ticket id", async () => {
    const first = await ticket();
    const second = await ticket();
    const authored = await create(first, "USER");
    expect((await remove(second, authored.body.data.id, "ADMIN")).status).toBe(
      404,
    );
    expect(
      await db
        .select()
        .from(comments)
        .where(eq(comments.id, authored.body.data.id)),
    ).toHaveLength(1);
  });

  it("paginates oldest first with UUID tie-breaks, isolated totals and empty pages", async () => {
    const id = await ticket();
    const other = await ticket();
    const ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
    const rows = await db
      .insert(comments)
      .values([
        {
          id: ids[1],
          ticketId: id,
          authorId: accounts.USER.id,
          body: "Second tie",
          createdAt: new Date("2000-01-01T00:00:00Z"),
        },
        {
          id: ids[0],
          ticketId: id,
          authorId: accounts.USER.id,
          body: "First tie",
          createdAt: new Date("2000-01-01T00:00:00Z"),
        },
        {
          ticketId: id,
          authorId: accounts.USER.id,
          body: "Latest",
          createdAt: new Date("2001-01-01T00:00:00Z"),
        },
        { ticketId: other, authorId: accounts.USER.id, body: "Other ticket" },
      ])
      .returning();
    const auth = `Bearer ${accounts.USER.token}`;
    const defaults = await request(app)
      .get(`/api/v1/tickets/${id}/comments`)
      .set("Authorization", auth);
    expect(defaults.body.data).toMatchObject({ page: 1, limit: 50, total: 3 });
    expect(
      defaults.body.data.data.map((row: { id: string }) => row.id),
    ).toEqual([ids[0], ids[1], rows[2].id]);
    for (const [page, expected] of [
      [1, [ids[0], ids[1]]],
      [2, [rows[2].id]],
      [3, []],
    ] as const) {
      const response = await request(app)
        .get(`/api/v1/tickets/${id}/comments`)
        .query({ page, limit: 2 })
        .set("Authorization", auth);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ page, limit: 2, total: 3 });
      expect(
        response.body.data.data.map((row: { id: string }) => row.id),
      ).toEqual(expected);
    }
    const empty = await request(app)
      .get(`/api/v1/tickets/${await ticket()}/comments`)
      .set("Authorization", auth);
    expect(empty.body.data).toMatchObject({ data: [], total: 0 });
  });

  it("requires authentication, validates bodies and pagination, and enforces CSRF for deletion", async () => {
    const id = await ticket();
    const made = await create(id, "USER");
    const path = `/api/v1/tickets/${id}/comments`;
    expect((await request(app).get(path)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(path)
          .set("X-CSRF-Protection", "1")
          .send({ body: "Test" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .delete(`${path}/${made.body.data.id}`)
          .set("X-CSRF-Protection", "1")
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .delete(`${path}/${made.body.data.id}`)
          .set("Authorization", `Bearer ${accounts.USER.token}`)
      ).status,
    ).toBe(403);
    for (const body of [
      { body: "   " },
      { body: "x".repeat(4001) },
      { body: "Test", authorId: accounts.ADMIN.id },
    ]) {
      expect((await create(id, "USER", body)).status).toBe(400);
    }
    for (const query of [{ page: 0 }, { limit: 101 }]) {
      expect(
        (
          await request(app)
            .get(path)
            .query(query)
            .set("Authorization", `Bearer ${accounts.USER.token}`)
        ).status,
      ).toBe(400);
    }
  });
});
