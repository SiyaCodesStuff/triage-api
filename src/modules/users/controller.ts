import type { RequestHandler } from "express";
import { forbidden, unauthorized } from "../../lib/app-error.js";
import type { SafeUser } from "../auth/service.js";
import type {
  changeRoleRequestSchema,
  listUsersRequestSchema,
  getUserRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";

export const getMe: RequestHandler = async (request, response) => {
  if (!request.actor) throw unauthorized();
  const user = await service.getUser(request.actor.userId);
  response.json({ data: user });
};

export const list: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  if (actor.role !== "ADMIN")
    throw forbidden("Only administrators can list users");
  const { query } = request.validated as ReturnType<
    typeof listUsersRequestSchema.parse
  >;
  response.json({
    data: await service.listUsers(query.page, query.limit, query.search),
  });
};

export const updateRole: RequestHandler = async (request, response) => {
  const actor = request.actor;
  if (!actor) throw unauthorized();
  if (actor.role !== "ADMIN")
    throw forbidden("Only administrators can change user roles");
  const { body, params } = request.validated as ReturnType<
    typeof changeRoleRequestSchema.parse
  >;
  if (params.userId === actor.userId && body.role !== "ADMIN") {
    throw forbidden(
      "Administrators cannot remove their own administrator role",
    );
  }
  const user: SafeUser = await service.changeRole(params.userId, body.role);
  response.json({ data: user });
};

// Consult the database so an old access JWT cannot retain administrator access
// to user management after a role change.
export const requireAdmin: RequestHandler = async (
  request,
  _response,
  next,
) => {
  if (!request.actor) throw unauthorized();
  const user = await service.getUser(request.actor.userId);
  if (user.role !== "ADMIN")
    throw forbidden("Only administrators can manage users");
  request.actor.role = user.role;
  next();
};

export const getById: RequestHandler = async (request, response) => {
  const { params } = request.validated as ReturnType<
    typeof getUserRequestSchema.parse
  >;
  response.json({ data: await service.getUser(params.userId) });
};
