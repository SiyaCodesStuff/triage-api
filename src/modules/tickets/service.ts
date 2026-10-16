import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  tickets,
  users,
  type Priority,
  type Role,
  type TicketStatus,
} from "../../db/schema.js";
import { getPagination } from "../../lib/pagination.js";
import type { listTicketsRequestSchema } from "./schemas.js";
import { badRequest, forbidden, notFound } from "../../lib/app-error.js";

export type Actor = { userId: string; role: Role };
export type TicketRecord = typeof tickets.$inferSelect;

function assertCanRead(ticket: TicketRecord, actor: Actor): void {
  if (actor.role === "USER" && ticket.createdBy !== actor.userId) {
    throw notFound("Ticket was not found");
  }
}

export async function listTickets(
  actor: Actor,
  filters: ReturnType<typeof listTicketsRequestSchema.parse>["query"],
) {
  const pagination = getPagination(filters);
  const conditions: SQL[] = [];
  if (actor.role === "USER")
    conditions.push(eq(tickets.createdBy, actor.userId));
  if (filters.status) conditions.push(eq(tickets.status, filters.status));
  if (filters.priority) conditions.push(eq(tickets.priority, filters.priority));
  if (actor.role !== "USER" && filters.createdBy)
    conditions.push(eq(tickets.createdBy, filters.createdBy));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(ilike(tickets.title, pattern), ilike(tickets.description, pattern))!,
    );
  }
  if (filters.assignedTo) {
    conditions.push(eq(tickets.assignedTo, filters.assignedTo));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const sortColumn = {
    createdAt: tickets.createdAt,
    priority: tickets.priority,
    status: tickets.status,
  }[filters.sort];
  const direction = filters.order === "asc" ? asc : desc;
  const [data, [totalRow]] = await Promise.all([
    db
      .select()
      .from(tickets)
      .where(where)
      .orderBy(direction(sortColumn), direction(tickets.id))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db.select({ total: count() }).from(tickets).where(where),
  ]);
  return {
    data,
    meta: pagination.meta(totalRow?.total ?? 0),
  };
}

export async function getTicket(
  ticketId: string,
  actor: Actor,
): Promise<TicketRecord> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) throw notFound("Ticket was not found");
  assertCanRead(ticket, actor);
  return ticket;
}

export async function createTicket(
  actor: Actor,
  input: { title: string; description: string; priority: Priority },
): Promise<TicketRecord> {
  const [ticket] = await db
    .insert(tickets)
    .values({ ...input, createdBy: actor.userId })
    .returning();
  if (!ticket) throw new Error("Ticket insert did not return a row");
  return ticket;
}

export async function updateTicket(
  ticketId: string,
  actor: Actor,
  changes: {
    title?: string;
    description?: string;
    status?: TicketStatus;
    priority?: Priority;
    assignedTo?: string | null;
  },
): Promise<TicketRecord> {
  return db.transaction(async (transaction) => {
    const [ticket] = await transaction
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update");
    if (!ticket) throw notFound("Ticket was not found");
    assertCanRead(ticket, actor);
    const staff = actor.role === "AGENT" || actor.role === "ADMIN";
    if (
      !staff &&
      (changes.status !== undefined ||
        changes.priority !== undefined ||
        changes.assignedTo !== undefined)
    ) {
      throw forbidden(
        "Only agents and administrators can change ticket status, priority, or assignment",
      );
    }

    if (!staff && ticket.status !== "OPEN") {
      throw forbidden("Users can only edit tickets while they are OPEN");
    }
    const transitions: Record<TicketStatus, readonly TicketStatus[]> = {
      OPEN: ["IN_PROGRESS"],
      IN_PROGRESS: ["RESOLVED"],
      RESOLVED: ["CLOSED", "OPEN"],
      CLOSED: [],
    };
    if (
      changes.status !== undefined &&
      !transitions[ticket.status].includes(changes.status)
    ) {
      throw badRequest(
        `Cannot transition ticket from ${ticket.status} to ${changes.status}`,
      );
    }

    if (changes.assignedTo) {
      const [assignee] = await transaction
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, changes.assignedTo))
        .limit(1);
      if (!assignee) throw badRequest("The selected assignee does not exist");
      if (assignee.role === "USER")
        throw badRequest(
          "Tickets can only be assigned to agents or administrators",
        );
    }

    const [updated] = await transaction
      .update(tickets)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id))
      .returning();
    if (!updated) throw notFound("Ticket was not found");
    return updated;
  });
}

export async function deleteTicket(
  ticketId: string,
  actor: Actor,
): Promise<void> {
  if (actor.role === "USER") await getTicket(ticketId, actor);
  if (actor.role !== "ADMIN")
    throw forbidden("Only administrators can delete tickets");
  const [deleted] = await db
    .delete(tickets)
    .where(eq(tickets.id, ticketId))
    .returning({ id: tickets.id });
  if (!deleted) throw notFound("Ticket was not found");
}
