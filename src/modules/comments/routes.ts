import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import * as controller from "./controller.js";
import {
  createCommentRequestSchema,
  listCommentsRequestSchema,
} from "./schemas.js";

export const commentsRouter = Router();

commentsRouter.use(authenticate);
commentsRouter.get(
  "/tickets/:ticketId/comments",
  validateRequest(listCommentsRequestSchema),
  controller.list,
);
commentsRouter.post(
  "/tickets/:ticketId/comments",
  validateRequest(createCommentRequestSchema),
  controller.create,
);
