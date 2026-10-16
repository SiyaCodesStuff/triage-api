import { z } from "../lib/zod.js";
import { priorities, roles, ticketStatuses } from "../db/schema.js";

export const noRequestDataSchema = z.strictObject({
  body: z.strictObject({}).optional(),
  params: z.strictObject({}),
  query: z.strictObject({}),
});
const timestamps = {
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
};
export const publicUserSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(roles),
  ...timestamps,
});
export const ticketResponseSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  description: z.string(),
  status: z.enum(ticketStatuses),
  priority: z.enum(priorities),
  createdBy: z.uuid(),
  assignedTo: z.uuid().nullable(),
  ...timestamps,
});
export const commentResponseSchema = z.strictObject({
  id: z.uuid(),
  ticketId: z.uuid(),
  body: z.string().min(1).max(5000),
  ...timestamps,
});
export const listedCommentSchema = commentResponseSchema.extend({
  author: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    role: z.enum(roles),
  }),
});
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export const validationDetailsSchema = z.array(
  z.strictObject({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  }),
);
