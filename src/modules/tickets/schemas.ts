import { z } from "zod";
import { paginationQuery } from "../../lib/pagination.js";
import { priorities, ticketStatuses } from "../../db/schema.js";

const emptyObject = z.strictObject({});

export const ticketIdParams = z.strictObject({ ticketId: z.uuid() });

export const listTicketsRequestSchema = z.strictObject({
  body: emptyObject.optional(),
  params: emptyObject,
  query: z.strictObject({
    status: z.enum(ticketStatuses).optional(),
    priority: z.enum(priorities).optional(),
    assignedTo: z.uuid().optional(),
    createdBy: z.uuid().optional(),
    q: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(["createdAt", "priority", "status"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    ...paginationQuery,
  }),
});

export const createTicketRequestSchema = z.strictObject({
  body: z.strictObject({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(10_000),
    priority: z.enum(priorities).default("MEDIUM"),
  }),
  params: emptyObject,
  query: emptyObject,
});

export const getTicketRequestSchema = z.strictObject({
  body: emptyObject.optional(),
  params: ticketIdParams,
  query: emptyObject,
});

export const updateTicketRequestSchema = z.strictObject({
  body: z
    .strictObject({
      title: z.string().trim().min(3).max(200).optional(),
      description: z.string().trim().min(1).max(10_000).optional(),
      status: z.enum(ticketStatuses).optional(),
      priority: z.enum(priorities).optional(),
      assignedTo: z.uuid().nullable().optional(),
    })
    .refine(
      (body) => Object.keys(body).length > 0,
      "At least one field must be provided",
    ),
  params: ticketIdParams,
  query: emptyObject,
});

export const deleteTicketRequestSchema = getTicketRequestSchema;
