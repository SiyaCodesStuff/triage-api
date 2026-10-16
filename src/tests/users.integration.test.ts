import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createUser, loginAs } from "./helpers/index.js";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users, type Role } from "../db/schema.js";
import { readSeedConfiguration, seedAdmin } from "../db/seed.js";

const publicKeys = [
  "id",
  "name",
  "email",
  "role",
  "createdAt",
  "updatedAt",
].sort();

describe("administrator user management and seeding", () => {
  const prefix = `management-${crypto.randomUUID()}`;
  const accounts = {} as Record<Role, { id: string; token: string }>;
  beforeEach(async () => {
    for (const key of ["USER", "AGENT", "ADMIN"] as const) {
      const role: Role = key;
      accounts[key] = await loginAs(
        await createUser({
          name: `${prefix} ${key}`,
          email: `${prefix}-${key.toLowerCase()}@example.test`,
          role,
        }),
      );
    }
  });

  it.each(["USER", "AGENT", "ADMIN"] as const)(
    "enforces %s access on every user-management endpoint",
    async (role) => {
      const expected = role === "ADMIN" ? 200 : 403;
      const auth = `Bearer ${accounts[role].token}`;
      const listed = await request(app)
        .get("/api/v1/users")
        .set("Authorization", auth);
      expect(listed.status).toBe(expected);
      const fetched = await request(app)
        .get(`/api/v1/users/${accounts.USER.id}`)
        .set("Authorization", auth);
      expect(fetched.status).toBe(expected);
      const changed = await request(app)
        .patch(`/api/v1/users/${accounts.USER.id}/role`)
        .set("Authorization", auth)
        .set("X-CSRF-Protection", "1")
        .send({ role: "USER" });
      expect(changed.status).toBe(expected);
      if (role === "ADMIN") {
        for (const user of [
          ...listed.body.data.data,
          fetched.body.data,
          changed.body.data,
        ]) {
          expect(Object.keys(user).sort()).toEqual(publicKeys);
        }
      } else {
        for (const response of [listed, fetched, changed])
          expect(response.body.error.code).toBe("FORBIDDEN");
      }
      const me = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", auth);
      expect(me.status).toBe(200);
      expect(me.body.data.id).toBe(accounts[role].id);
      expect(Object.keys(me.body.data).sort()).toEqual(publicKeys);
    },
  );

  it("requires authentication for user-management endpoints", async () => {
    for (const path of ["/api/v1/users", `/api/v1/users/${accounts.USER.id}`]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    const response = await request(app)
      .patch(`/api/v1/users/${accounts.USER.id}/role`)
      .set("X-CSRF-Protection", "1")
      .send({ role: "AGENT" });
    expect(response.status).toBe(401);
  });

  it("searches name/email case-insensitively with stable pagination and filtered totals", async () => {
    const auth = `Bearer ${accounts.ADMIN.token}`;
    const first = await request(app)
      .get("/api/v1/users")
      .query({ search: prefix.toUpperCase(), page: 1, limit: 2 })
      .set("Authorization", auth);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(first.body.data.data).toHaveLength(2);
    const second = await request(app)
      .get("/api/v1/users")
      .query({ search: prefix, page: 2, limit: 2 })
      .set("Authorization", auth);
    expect(second.status).toBe(200);
    expect(second.body.data.data).toHaveLength(1);
    expect(
      new Set(
        [...first.body.data.data, ...second.body.data.data].map(
          (user: { id: string }) => user.id,
        ),
      ).size,
    ).toBe(3);
    const emailSearch = await request(app)
      .get("/api/v1/users")
      .query({ search: `${prefix}-agent@EXAMPLE.TEST` })
      .set("Authorization", auth);
    expect(emailSearch.body.data.total).toBe(1);
    expect(emailSearch.body.data.data[0].id).toBe(accounts.AGENT.id);
    const literal = await request(app)
      .get("/api/v1/users")
      .query({ search: `${prefix}%` })
      .set("Authorization", auth);
    expect(literal.body.data).toMatchObject({ data: [], total: 0 });
    const beyond = await request(app)
      .get("/api/v1/users")
      .query({ search: prefix, page: 10 })
      .set("Authorization", auth);
    expect(beyond.body.data).toMatchObject({ data: [], total: 3 });
  });

  it("blocks self-demotion, permits retaining ADMIN, and reports invalid or missing users", async () => {
    const auth = `Bearer ${accounts.ADMIN.token}`;
    for (const role of ["USER", "AGENT"]) {
      const response = await request(app)
        .patch(`/api/v1/users/${accounts.ADMIN.id}/role`)
        .set("Authorization", auth)
        .set("X-CSRF-Protection", "1")
        .send({ role });
      expect(response.status).toBe(403);
    }
    const retained = await request(app)
      .patch(`/api/v1/users/${accounts.ADMIN.id}/role`)
      .set("Authorization", auth)
      .set("X-CSRF-Protection", "1")
      .send({ role: "ADMIN" });
    expect(retained.status).toBe(200);
    const changed = await request(app)
      .patch(`/api/v1/users/${accounts.USER.id}/role`)
      .set("Authorization", auth)
      .set("X-CSRF-Protection", "1")
      .send({ role: "AGENT" });
    expect(changed.status).toBe(200);
    expect(changed.body.data.role).toBe("AGENT");
    await db
      .update(users)
      .set({ role: "USER" })
      .where(eq(users.id, accounts.USER.id));
    for (const path of [
      "/api/v1/users/not-a-uuid",
      "/api/v1/users?limit=101",
      "/api/v1/users?page=0",
      "/api/v1/users?search=",
    ]) {
      expect(
        (await request(app).get(path).set("Authorization", auth)).status,
      ).toBe(400);
    }
    const missing = crypto.randomUUID();
    expect(
      (
        await request(app)
          .get(`/api/v1/users/${missing}`)
          .set("Authorization", auth)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/users/${missing}/role`)
          .set("Authorization", auth)
          .set("X-CSRF-Protection", "1")
          .send({ role: "AGENT" })
      ).status,
    ).toBe(404);
  });

  it("an ADMIN demoted to USER immediately gets 403 with the same still-valid access token", async () => {
    const auth = `Bearer ${accounts.ADMIN.token}`;
    expect(
      (await request(app).get("/api/v1/users").set("Authorization", auth))
        .status,
    ).toBe(200);
    await db
      .update(users)
      .set({ role: "USER" })
      .where(eq(users.id, accounts.ADMIN.id));
    try {
      expect(() =>
        jwt.verify(accounts.ADMIN.token, env.JWT_ACCESS_SECRET),
      ).not.toThrow();
      const response = await request(app)
        .get("/api/v1/users")
        .set("Authorization", auth);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      const me = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", auth);
      expect(me.status).toBe(200);
      expect(me.body.data.role).toBe("USER");
    } finally {
      await db
        .update(users)
        .set({ role: "ADMIN" })
        .where(eq(users.id, accounts.ADMIN.id));
    }
  });

  it.each(["bearer", "cookie"])(
    "returns the standard 401 for a deleted user's still-valid %s credential",
    async (transport) => {
      const id = crypto.randomUUID();
      await db.insert(users).values({
        id,
        name: "Deleted test user",
        email: `${id}@example.test`,
        passwordHash: "unused-test-value",
      });

      const token = jwt.sign(
        { role: "ADMIN", type: "access" },
        env.JWT_ACCESS_SECRET,
        {
          subject: id,
          jwtid: crypto.randomUUID(),
          issuer: "triage-api",
          audience: "triage-api-client",
          expiresIn: "5m",
        },
      );
      await db.delete(users).where(eq(users.id, id));
      for (const path of [
        "/api/v1/users/me",
        "/api/v1/users",
        "/api/v1/tickets",
        `/api/v1/tickets/${crypto.randomUUID()}/comments`,
      ]) {
        const response = await request(app)
          .get(path)
          .set(
            transport === "bearer" ? "Authorization" : "Cookie",
            transport === "bearer"
              ? `Bearer ${token}`
              : `triage_access=${token}`,
          );
        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication is required",
          },
        });
      }
    },
  );

  it("a normal authenticated request still returns the current public profile", async () => {
    const response = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${accounts.USER.token}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: accounts.USER.id,
      role: "USER",
    });
    expect(Object.keys(response.body.data).sort()).toEqual(publicKeys);
  });

  it("seeds one lowercase Argon2id admin idempotently without resetting its password", async () => {
    const configuration = readSeedConfiguration(
      {
        ADMIN_EMAIL: ` Seed-${crypto.randomUUID()}@Example.Test `,
        ADMIN_PASSWORD: "first seed password",
      },
      [],
    );
    try {
      const outcomes = await Promise.all([
        seedAdmin(db, configuration),
        seedAdmin(db, configuration),
      ]);
      expect(outcomes.sort()).toEqual(["created", "existing"]);
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, configuration.ADMIN_EMAIL));
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("ADMIN");
      expect(rows[0].passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(
        await argon2.verify(rows[0].passwordHash, configuration.ADMIN_PASSWORD),
      ).toBe(true);
      expect(
        await seedAdmin(db, {
          ...configuration,
          ADMIN_PASSWORD: "different seed password",
        }),
      ).toBe("existing");
      const [unchanged] = await db
        .select()
        .from(users)
        .where(eq(users.email, configuration.ADMIN_EMAIL));
      expect(unchanged.passwordHash === rows[0].passwordHash).toBe(true);
    } finally {
      await db.delete(users).where(eq(users.email, configuration.ADMIN_EMAIL));
    }
  });

  it("refuses to promote an existing USER through seeding", async () => {
    const [account] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, accounts.USER.id));
    await expect(
      seedAdmin(db, {
        ADMIN_EMAIL: account.email,
        ADMIN_PASSWORD: "seed password test",
      }),
    ).rejects.toThrow("refusing to promote");
    const [unchanged] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, accounts.USER.id));
    expect(unchanged.role).toBe("USER");
  });
});
