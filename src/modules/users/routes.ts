import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { validateRequest } from "../../middleware/validate-request.js";
import * as controller from "./controller.js";
import {
  changeRoleRequestSchema,
  getMeRequestSchema,
  getUserRequestSchema,
  listUsersRequestSchema,
} from "./schemas.js";

export const usersRouter = Router();

usersRouter.get(
  "/me",
  requireAuth,
  validateRequest(getMeRequestSchema),
  controller.getMe,
);
usersRouter.get(
  "/",
  requireAuth,
  controller.requireAdmin,
  validateRequest(listUsersRequestSchema),
  controller.list,
);
usersRouter.patch(
  "/:userId/role",
  requireAuth,
  controller.requireAdmin,
  validateRequest(changeRoleRequestSchema),
  controller.updateRole,
);

usersRouter.get(
  "/:userId",
  requireAuth,
  controller.requireAdmin,
  validateRequest(getUserRequestSchema),
  controller.getById,
);
