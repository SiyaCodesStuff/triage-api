import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error.js";
import { logger } from "../config/logger.js";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, "NOT_FOUND", "The requested endpoint was not found"));
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  void next;
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid data",
        details: error.issues.map(({ path, message }) => ({ path, message })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON",
      },
    });
    return;
  }

  logger.error(
    { err: error, method: request.method, path: request.path },
    "Unhandled request error",
  );
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
