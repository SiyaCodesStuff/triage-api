import { asc, count, eq, ilike, or } from "drizzle-orm";
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
  search?: string,
): Promise<{ data: SafeUser[]; page: number; limit: number; total: number }> {
  // Escape LIKE metacharacters so search is a literal substring.
  const pattern =
    search === undefined ? undefined : `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where =
    pattern === undefined
      ? undefined
      : or(ilike(users.name, pattern), ilike(users.email, pattern));
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
    .where(where)
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [result] = await db.select({ total: count() }).from(users).where(where);
  return { data, page, limit, total: result?.total ?? 0 };
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
