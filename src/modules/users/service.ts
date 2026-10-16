import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, type Role } from "../../db/schema.js";
import { notFound } from "../../lib/app-error.js";
import type { SafeUser } from "../auth/service.js";

export async function getUser(userId: string): Promise<SafeUser> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw notFound("User was not found");
  return user;
}

export async function listUsers(
  page: number,
  limit: number,
): Promise<{ data: SafeUser[]; page: number; limit: number }> {
  const data = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data, page, limit };
}

export async function changeRole(
  userId: string,
  role: Role,
): Promise<SafeUser> {
  const [user] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });
  if (!user) throw notFound("User was not found");
  return user;
}
