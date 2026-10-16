import { z } from "../../lib/zod.js";
import { roles } from "../../db/schema.js";

export const emptyQuery = z.strictObject({});
export const emptyParams = z.strictObject({});

export const userIdParams = z.strictObject({ userId: z.uuid() });

export const getMeRequestSchema = z.strictObject({
  body: emptyParams.optional(),
  params: emptyParams,
  query: emptyQuery,
});

export const listUsersRequestSchema = z.strictObject({
  body: emptyParams.optional(),
  params: emptyParams,
  query: z.strictObject({
    search: z.string().trim().min(1).max(254).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const changeRoleRequestSchema = z.strictObject({
  body: z.strictObject({ role: z.enum(roles) }),
  params: userIdParams,
  query: emptyQuery,
});

export const getUserRequestSchema = z.strictObject({
  body: emptyParams.optional(),
  params: userIdParams,
  query: emptyQuery,
});
