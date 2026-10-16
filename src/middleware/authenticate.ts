import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { verifyAccessToken } from "../modules/auth/service.js";
import { getCookie } from "../lib/cookies.js";
import { unauthorized } from "../lib/app-error.js";

export const authenticate: RequestHandler = async (
  request,
  _response,
  next,
) => {
  // Some routers overlap (ticket comments); reuse only within this request.
  if (request.user) {
    next();
    return;
  }
  const authorization = request.header("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? getCookie(request, "triage_access");
  if (!token) throw unauthorized();

  let userId: string;
  try {
    userId = verifyAccessToken(token).userId;
  } catch {
    throw unauthorized("The access credential is invalid or expired");
  }
  // Only identity comes from the JWT. Authorization always uses the current row.
  // Keep database failures outside the credential catch so they remain server errors.
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw unauthorized();
  request.user = user;
  next();
};
