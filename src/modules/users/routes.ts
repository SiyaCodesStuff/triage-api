import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
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
  authenticate,
  validateRequest(getMeRequestSchema),
  controller.getMe,
);
usersRouter.get(
  "/",
  authenticate,
  controller.requireAdmin,
  validateRequest(listUsersRequestSchema),
  controller.list,
);
usersRouter.patch(
  "/:userId/role",
  authenticate,
  controller.requireAdmin,
  validateRequest(changeRoleRequestSchema),
  controller.updateRole,
);

usersRouter.get(
  "/:userId",
  authenticate,
  controller.requireAdmin,
  validateRequest(getUserRequestSchema),
  controller.getById,
);
