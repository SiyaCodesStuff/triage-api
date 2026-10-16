import type { RequestHandler } from "express";
import { verifyAccessToken } from "../modules/auth/service.js";
import { getCookie } from "../lib/cookies.js";
import { unauthorized } from "../lib/app-error.js";

export const requireAuth: RequestHandler = (request, _response, next) => {
  const authorization = request.header("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? getCookie(request, "triage_access");

  if (!token) {
    next(unauthorized());
    return;
  }

  try {
    request.actor = verifyAccessToken(token);
    next();
  } catch {
    next(unauthorized("The access credential is invalid or expired"));
  }
};
