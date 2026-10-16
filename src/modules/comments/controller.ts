import type { RequestHandler } from "express";
import { unauthorized } from "../../lib/app-error.js";
import type {
  createCommentRequestSchema,
  listCommentsRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";

export const list: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { params, query } = request.validated as ReturnType<
    typeof listCommentsRequestSchema.parse
  >;
  response.json({
    data: await service.listComments(
      params.ticketId,
      actor,
      query.page,
      query.limit,
    ),
  });
};

export const create: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  const { body, params } = request.validated as ReturnType<
    typeof createCommentRequestSchema.parse
  >;
  response.status(201).json({
    data: await service.createComment(params.ticketId, actor, body.body),
  });
};
