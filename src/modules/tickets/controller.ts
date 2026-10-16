import type { RequestHandler } from "express";
import { unauthorized } from "../../lib/app-error.js";
import * as service from "./service.js";
import type {
  createTicketRequestSchema,
  deleteTicketRequestSchema,
  getTicketRequestSchema,
  listTicketsRequestSchema,
  updateTicketRequestSchema,
} from "./schemas.js";

export const list: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { query } = request.validated as ReturnType<
    typeof listTicketsRequestSchema.parse
  >;
  response.json({ data: await service.listTickets(actor, query) });
};

export const create: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { body } = request.validated as ReturnType<
    typeof createTicketRequestSchema.parse
  >;
  response.status(201).json({ data: await service.createTicket(actor, body) });
};

export const get: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { params } = request.validated as ReturnType<
    typeof getTicketRequestSchema.parse
  >;
  response.json({ data: await service.getTicket(params.ticketId, actor) });
};

export const update: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { body, params } = request.validated as ReturnType<
    typeof updateTicketRequestSchema.parse
  >;
  response.json({
    data: await service.updateTicket(params.ticketId, actor, body),
  });
};

export const remove: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { params } = request.validated as ReturnType<
    typeof deleteTicketRequestSchema.parse
  >;
  await service.deleteTicket(params.ticketId, actor);
  response.status(204).end();
};
