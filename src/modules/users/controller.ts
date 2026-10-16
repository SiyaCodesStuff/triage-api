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
  if (!request.user) throw unauthorized();
  const user = await service.getUser(request.user.id);
  response.json({ data: user });
};

export const list: RequestHandler = async (request, response) => {
  const actor = request.user;
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
  const actor = request.user;
  if (!actor) throw unauthorized();
  if (actor.role !== "ADMIN")
    throw forbidden("Only administrators can change user roles");
  const { body, params } = request.validated as ReturnType<
    typeof changeRoleRequestSchema.parse
  >;
  if (params.userId === actor.id && body.role !== "ADMIN") {
    throw forbidden(
      "Administrators cannot remove their own administrator role",
    );
  }
  const user: SafeUser = await service.changeRole(params.userId, body.role);
  response.json({ data: user });
};

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (!request.user) throw unauthorized();
  if (request.user.role !== "ADMIN")
    throw forbidden("Only administrators can manage users");
  next();
};

export const getById: RequestHandler = async (request, response) => {
  const { params } = request.validated as ReturnType<
    typeof getUserRequestSchema.parse
  >;
  response.json({ data: await service.getUser(params.userId) });
};
