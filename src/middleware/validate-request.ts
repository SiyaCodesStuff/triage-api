import type { RequestHandler } from "express";
import type { z } from "zod";

export function validateRequest<T>(schema: z.ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    try {
      request.validated = schema.parse({
        body: request.body,
        params: request.params,
        query: request.query,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
