import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq, inArray } from "drizzle-orm";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { db, pool } from "../db/client.js";
import {
  tickets,
  users,
  ticketStatuses,
  type Role,
  type TicketStatus,
} from "../db/schema.js";

describe("ticket authorization and lifecycle", () => {
  const accounts = {} as Record<
    "USER" | "OTHER" | "AGENT" | "ADMIN",
    { id: string; token: string }
  >;
  const userIds: string[] = [];
  const ticketIds: string[] = [];
  beforeAll(async () => {
    for (const key of ["USER", "OTHER", "AGENT", "ADMIN"] as const) {
      const role: Role = key === "OTHER" ? "USER" : key;
      const id = crypto.randomUUID();
      await db.insert(users).values({
        id,
        name: `Ticket test ${key}`,
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
  async function fixture(
    owner = "USER" as keyof typeof accounts,
    status: TicketStatus = "OPEN",
  ) {
    const [ticket] = await db
      .insert(tickets)
      .values({
        title: "Test ticket",
        description: "Test description",
        createdBy: accounts[owner].id,
        status,
      })
      .returning();
    ticketIds.push(ticket.id);
    return ticket;
  }
  function patch(id: string, role: keyof typeof accounts, body: object) {
    return request(app)
      .patch(`/api/v1/tickets/${id}`)
      .set("Authorization", `Bearer ${accounts[role].token}`)
      .set("X-CSRF-Protection", "1")
      .send(body);
  }

  it.each(["USER", "AGENT", "ADMIN"] as const)(
    "lets %s create an OPEN ticket owned by the caller",
    async (role) => {
      const response = await request(app)
        .post("/api/v1/tickets")
        .set("Authorization", `Bearer ${accounts[role].token}`)
        .set("X-CSRF-Protection", "1")
        .send({ title: "New ticket", description: "A problem" });
      if (response.body.data?.id) ticketIds.push(response.body.data.id);
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        createdBy: accounts[role].id,
        status: "OPEN",
        assignedTo: null,
      });
      const injected = await request(app)
        .post("/api/v1/tickets")
        .set("Authorization", `Bearer ${accounts[role].token}`)
        .set("X-CSRF-Protection", "1")
        .send({
          title: "New ticket",
          description: "A problem",
          createdBy: accounts.OTHER.id,
          status: "CLOSED",
        });
      expect(injected.status).toBe(400);
    },
  );

  it("USER lists only own tickets and receives identical 404s for foreign and missing tickets", async () => {
    const own = await fixture();
    const other = await fixture("OTHER");
    const listed = await request(app)
      .get("/api/v1/tickets?limit=100")
      .set("Authorization", `Bearer ${accounts.USER.token}`);
    expect(listed.status).toBe(200);
    expect(
      listed.body.data.data.some(
        (ticket: { id: string }) => ticket.id === own.id,
      ),
    ).toBe(true);
    expect(
      listed.body.data.data.every(
        (ticket: { createdBy: string }) =>
          ticket.createdBy === accounts.USER.id,
      ),
    ).toBe(true);
    const ownGet = await request(app)
      .get(`/api/v1/tickets/${own.id}`)
      .set("Authorization", `Bearer ${accounts.USER.token}`);
    expect(ownGet.status).toBe(200);
    for (const method of ["get", "patch", "delete"] as const) {
      const responses = [];
      for (const id of [other.id, crypto.randomUUID()]) {
        const call = request(app)
          [method](`/api/v1/tickets/${id}`)
          .set("Authorization", `Bearer ${accounts.USER.token}`)
          .set("X-CSRF-Protection", "1");
        const response = await (method === "patch"
          ? call.send({ title: "Changed title" })
          : call);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("NOT_FOUND");
        responses.push(response.body);
      }
      expect(responses[0]).toEqual(responses[1]);
    }
  });

  it("USER edits own OPEN title/description and cannot change staff fields, ownership or delete", async () => {
    const ticket = await fixture();
    const edited = await patch(ticket.id, "USER", {
      title: "Updated title",
      description: "Updated description",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      title: "Updated title",
      description: "Updated description",
    });
    for (const body of [
      { status: "IN_PROGRESS" },
      { priority: "HIGH" },
      { assignedTo: accounts.AGENT.id },
      { assignedTo: null },
      { title: "Sneaky change", priority: "HIGH" },
    ]) {
      expect((await patch(ticket.id, "USER", body)).status).toBe(403);
    }
    expect(
      (await patch(ticket.id, "USER", { createdBy: accounts.OTHER.id })).status,
    ).toBe(400);
    const removed = await request(app)
      .delete(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${accounts.USER.token}`)
      .set("X-CSRF-Protection", "1");
    expect(removed.status).toBe(403);
    const [unchanged] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket.id));
    expect(unchanged).toMatchObject({
      title: "Updated title",
      status: "OPEN",
      priority: "MEDIUM",
      assignedTo: null,
    });
  });

  it.each(["IN_PROGRESS", "RESOLVED", "CLOSED"] as const)(
    "USER cannot edit own %s ticket",
    async (status) => {
      const ticket = await fixture("USER", status);
      expect(
        (await patch(ticket.id, "USER", { title: "Changed title" })).status,
      ).toBe(403);
      expect(
        (await patch(ticket.id, "USER", { description: "Changed description" }))
          .status,
      ).toBe(403);
      const [unchanged] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket.id));
      expect(unchanged.title).toBe(ticket.title);
      expect(unchanged.description).toBe(ticket.description);
    },
  );

  it.each(["AGENT", "ADMIN"] as const)(
    "%s sees other users' tickets, changes priority and assigns only staff",
    async (role) => {
      const ticket = await fixture("OTHER");
      expect(
        (
          await request(app)
            .get(`/api/v1/tickets/${ticket.id}`)
            .set("Authorization", `Bearer ${accounts[role].token}`)
        ).status,
      ).toBe(200);
      const listed = await request(app)
        .get("/api/v1/tickets?limit=100")
        .set("Authorization", `Bearer ${accounts[role].token}`);
      expect(listed.status).toBe(200);
      expect(
        listed.body.data.data.some(
          (row: { id: string }) => row.id === ticket.id,
        ),
      ).toBe(true);
      for (const assignee of ["AGENT", "ADMIN"] as const) {
        const response = await patch(ticket.id, role, {
          priority: "HIGH",
          assignedTo: accounts[assignee].id,
        });
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          priority: "HIGH",
          assignedTo: accounts[assignee].id,
        });
      }
      for (const assignedTo of [accounts.USER.id, crypto.randomUUID()]) {
        const response = await patch(ticket.id, role, {
          assignedTo,
          priority: "LOW",
        });
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("BAD_REQUEST");
      }
      const [unchanged] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket.id));
      expect(unchanged).toMatchObject({
        priority: "HIGH",
        assignedTo: accounts.ADMIN.id,
      });
      const cleared = await patch(ticket.id, role, { assignedTo: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.assignedTo).toBeNull();
    },
  );

  const allowed = new Set([
    "OPEN:IN_PROGRESS",
    "IN_PROGRESS:RESOLVED",
    "RESOLVED:CLOSED",
    "RESOLVED:OPEN",
  ]);
  const cases = (["AGENT", "ADMIN"] as const).flatMap((role) =>
    ticketStatuses.flatMap((from) =>
      ticketStatuses.map((to) => ({ role, from, to })),
    ),
  );
  it.each(cases)(
    "$role transition $from -> $to obeys the lifecycle",
    async ({ role, from, to }) => {
      const ticket = await fixture("USER", from);
      const valid = allowed.has(`${from}:${to}`);
      const response = await patch(ticket.id, role, {
        status: to,
        priority: "URGENT",
      });
      expect(response.status).toBe(valid ? 200 : 400);
      const [stored] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket.id));
      expect(stored.status).toBe(valid ? to : from);
      expect(stored.priority).toBe(valid ? "URGENT" : "MEDIUM");
      if (!valid) expect(response.body.error.code).toBe("BAD_REQUEST");
    },
  );

  it("serializes concurrent transitions so only one OPEN -> IN_PROGRESS succeeds", async () => {
    const ticket = await fixture();
    const responses = await Promise.all([
      patch(ticket.id, "AGENT", { status: "IN_PROGRESS" }),
      patch(ticket.id, "ADMIN", { status: "IN_PROGRESS" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
  });

  it.each(["AGENT", "ADMIN"] as const)(
    "applies current ticket permissions after %s is demoted despite an old JWT",
    async (role) => {
      const own = await fixture(role);
      const foreign = await fixture("OTHER");
      await db
        .update(users)
        .set({ role: "USER" })
        .where(eq(users.id, accounts[role].id));
      try {
        const auth = `Bearer ${accounts[role].token}`;
        expect(
          (
            await request(app)
              .get(`/api/v1/tickets/${foreign.id}`)
              .set("Authorization", auth)
          ).status,
        ).toBe(404);
        expect((await patch(own.id, role, { priority: "HIGH" })).status).toBe(
          403,
        );
        expect(
          (
            await request(app)
              .delete(`/api/v1/tickets/${own.id}`)
              .set("Authorization", auth)
              .set("X-CSRF-Protection", "1")
          ).status,
        ).toBe(403);
        const listed = await request(app)
          .get("/api/v1/tickets?limit=100")
          .set("Authorization", auth);
        expect(listed.status).toBe(200);
        expect(
          listed.body.data.data.every(
            (ticket: { createdBy: string }) =>
              ticket.createdBy === accounts[role].id,
          ),
        ).toBe(true);
        expect(
          (await patch(own.id, role, { title: "Still my OPEN ticket" })).status,
        ).toBe(200);
      } finally {
        await db
          .update(users)
          .set({ role })
          .where(eq(users.id, accounts[role].id));
      }
    },
  );

  it("only ADMIN deletes tickets, including CLOSED tickets", async () => {
    const ticket = await fixture("OTHER", "CLOSED");
    const agent = await request(app)
      .delete(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${accounts.AGENT.token}`)
      .set("X-CSRF-Protection", "1");
    expect(agent.status).toBe(403);
    const admin = await request(app)
      .delete(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${accounts.ADMIN.token}`)
      .set("X-CSRF-Protection", "1");
    expect(admin.status).toBe(204);
    expect(
      await db.select().from(tickets).where(eq(tickets.id, ticket.id)),
    ).toHaveLength(0);
  });
});
