import argon2 from "argon2";
import request from "supertest";
import { app } from "../../app.js";
import { db } from "../../db/client.js";
import { tickets, users, type Role } from "../../db/schema.js";
import { login } from "../../modules/auth/service.js";

const defaultPassword = "correct horse battery staple";
const defaultHash = argon2.hash(defaultPassword, { type: argon2.argon2id });

export async function createUser(
  input: { name?: string; email?: string; password?: string; role?: Role } = {},
) {
  const password = input.password ?? defaultPassword;
  const [user] = await db
    .insert(users)
    .values({
      name: input.name ?? "Test User",
      email: (input.email ?? `${crypto.randomUUID()}@example.test`)
        .trim()
        .toLowerCase(),
      role: input.role ?? "USER",
      passwordHash:
        input.password === undefined
          ? await defaultHash
          : await argon2.hash(password, { type: argon2.argon2id }),
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    });
  if (!user) throw new Error("Test user insert failed");
  return { ...user, password };
}

export async function loginAs(user: Awaited<ReturnType<typeof createUser>>) {
  // Exercise real password verification/token/session creation without spending
  // the HTTP limiter's shared budget on fixture setup.
  const result = await login(user.email, user.password);
  const agent = request.agent(app);
  agent.jar.setCookie(
    `triage_access=${result.tokens.accessToken}; Path=/; HttpOnly`,
    "127.0.0.1",
    "/",
  );
  agent.jar.setCookie(
    `triage_refresh=${result.tokens.refreshToken}; Path=/api/v1/auth; HttpOnly`,
    "127.0.0.1",
    "/",
  );
  return {
    id: result.user.id,
    token: result.tokens.accessToken,
    tokens: result.tokens,
    agent,
  };
}

export async function createTicket(
  owner: string | { id: string },
  input: Partial<Omit<typeof tickets.$inferInsert, "createdBy">> = {},
) {
  const [ticket] = await db
    .insert(tickets)
    .values({
      title: "Test ticket",
      description: "Test description",
      ...input,
      createdBy: typeof owner === "string" ? owner : owner.id,
    })
    .returning();
  if (!ticket) throw new Error("Test ticket insert failed");
  return ticket;
}
