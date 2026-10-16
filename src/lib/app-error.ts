export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message = "Authentication is required"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(
  message = "You do not have permission to do that",
): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(
  message = "The requested resource was not found",
): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}
