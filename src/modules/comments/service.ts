import { asc, count, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comments, users } from "../../db/schema.js";
import type { Actor } from "../tickets/service.js";
import { getTicket } from "../tickets/service.js";

export async function listComments(
  ticketId: string,
  actor: Actor,
  page: number,
  limit: number,
): Promise<{
  data: Array<{
    id: string;
    ticketId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; name: string; role: string };
  }>;
  page: number;
  limit: number;
  total: number;
}> {
  await getTicket(ticketId, actor);
  const [data, [totalRow]] = await Promise.all([
    db
      .select({
        id: comments.id,
        ticketId: comments.ticketId,
        body: comments.body,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: { id: users.id, name: users.name, role: users.role },
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.ticketId, ticketId))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: count() })
      .from(comments)
      .where(eq(comments.ticketId, ticketId)),
  ]);
  return { data, page, limit, total: totalRow?.total ?? 0 };
}

export async function createComment(
  ticketId: string,
  actor: Actor,
  body: string,
): Promise<{
  id: string;
  ticketId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}> {
  await getTicket(ticketId, actor);
  const [comment] = await db
    .insert(comments)
    .values({ ticketId, authorId: actor.userId, body })
    .returning({
      id: comments.id,
      ticketId: comments.ticketId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
    });
  if (!comment) throw new Error("Comment insert did not return a row");
  return comment;
}
