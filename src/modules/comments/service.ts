import { and, asc, count, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comments, tickets, users } from "../../db/schema.js";
import type { Actor } from "../tickets/service.js";
import { conflict, forbidden, notFound } from "../../lib/app-error.js";
import { assertCanRead, getTicket } from "../tickets/service.js";

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
  return db.transaction(async (transaction) => {
    const [ticket] = await transaction
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update");
    if (!ticket) throw notFound("Ticket was not found");
    assertCanRead(ticket, actor);
    if (ticket.status === "CLOSED")
      throw conflict("Closed tickets do not accept new comments");
    const [comment] = await transaction
      .insert(comments)
      .values({ ticketId, authorId: actor.id, body })
      .returning({
        id: comments.id,
        ticketId: comments.ticketId,
        body: comments.body,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      });
    if (!comment) throw new Error("Comment insert did not return a row");
    return comment;
  });
}

export async function deleteComment(
  ticketId: string,
  commentId: string,
  actor: Actor,
): Promise<void> {
  await getTicket(ticketId, actor);
  const where = and(
    eq(comments.id, commentId),
    eq(comments.ticketId, ticketId),
  );
  const [comment] = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(where)
    .limit(1);
  if (!comment) throw notFound("Comment was not found");
  if (actor.role !== "ADMIN" && comment.authorId !== actor.id)
    throw forbidden("Only the author or an administrator can delete a comment");
  const removed = await db
    .delete(comments)
    .where(where)
    .returning({ id: comments.id });
  if (!removed.length) throw notFound("Comment was not found");
}
