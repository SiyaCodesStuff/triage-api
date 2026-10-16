import { z } from "../../lib/zod.js";
import { ticketIdParams } from "../tickets/schemas.js";

const emptyObject = z.strictObject({});

export const listCommentsRequestSchema = z.strictObject({
  body: emptyObject.optional(),
  params: ticketIdParams,
  query: z.strictObject({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const createCommentRequestSchema = z.strictObject({
  body: z.strictObject({ body: z.string().trim().min(1).max(4_000) }),
  params: ticketIdParams,
  query: emptyObject,
});

export const deleteCommentRequestSchema = z.strictObject({
  body: emptyObject.optional(),
  params: ticketIdParams.extend({ commentId: z.uuid() }),
  query: emptyObject,
});
