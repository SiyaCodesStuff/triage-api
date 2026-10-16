import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import * as controller from "./controller.js";
import {
  createTicketRequestSchema,
  deleteTicketRequestSchema,
  getTicketRequestSchema,
  listTicketsRequestSchema,
  updateTicketRequestSchema,
} from "./schemas.js";

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get(
  "/",
  validateRequest(listTicketsRequestSchema),
  controller.list,
);
ticketsRouter.post(
  "/",
  validateRequest(createTicketRequestSchema),
  controller.create,
);
ticketsRouter.get(
  "/:ticketId",
  validateRequest(getTicketRequestSchema),
  controller.get,
);
ticketsRouter.patch(
  "/:ticketId",
  validateRequest(updateTicketRequestSchema),
  controller.update,
);
ticketsRouter.delete(
  "/:ticketId",
  validateRequest(deleteTicketRequestSchema),
  controller.remove,
);
