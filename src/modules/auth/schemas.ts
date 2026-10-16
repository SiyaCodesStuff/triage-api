import { z } from "../../lib/zod.js";

export const registerRequestSchema = z.strictObject({
  body: z.strictObject({
    name: z.string().trim().min(1).max(120),
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(10).max(128),
  }),
  params: z.strictObject({}),
  query: z.strictObject({}),
});

export const loginRequestSchema = z.strictObject({
  body: z.strictObject({
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(1).max(128),
  }),
  params: z.strictObject({}),
  query: z.strictObject({}),
});

export const refreshRequestSchema = z.strictObject({
  body: z.strictObject({}).optional(),
  params: z.strictObject({}),
  query: z.strictObject({}),
});

export const logoutRequestSchema = refreshRequestSchema;

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
