import type { Role } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      validated: unknown;
      actor?: { userId: string; role: Role };
    }
  }
}

export {};
