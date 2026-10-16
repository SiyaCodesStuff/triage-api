import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { validateRequest } from "../../middleware/validate-request.js";
import * as controller from "./controller.js";
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from "./schemas.js";

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many authentication attempts; try again later",
    },
  },
});

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimit,
  validateRequest(registerRequestSchema),
  controller.register,
);
authRouter.post(
  "/login",
  authRateLimit,
  validateRequest(loginRequestSchema),
  controller.login,
);
authRouter.post(
  "/refresh",
  authRateLimit,
  validateRequest(refreshRequestSchema),
  controller.refresh,
);
authRouter.post(
  "/logout",
  validateRequest(logoutRequestSchema),
  controller.logout,
);
