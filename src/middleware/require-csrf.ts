import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error.js";

// A custom header cannot be submitted by cross-origin HTML forms. Browser
// scripts from other origins must pass our credentialed CORS allowlist first.
export const requireCsrf: RequestHandler = (request, _response, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.header("X-CSRF-Protection") !== "1"
  ) {
    next(
      new AppError(403, "CSRF_REQUIRED", "X-CSRF-Protection: 1 is required"),
    );
    return;
  }
  next();
};
