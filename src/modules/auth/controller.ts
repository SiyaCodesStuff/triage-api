import type { RequestHandler } from "express";
import {
  getCookie,
  clearAuthCookies,
  setAuthCookies,
} from "../../lib/cookies.js";
import { unauthorized } from "../../lib/app-error.js";
import * as service from "./service.js";
import type { LoginRequest, RegisterRequest } from "./schemas.js";

export const register: RequestHandler = async (request, response) => {
  const { body } = request.validated as RegisterRequest;
  const result = await service.register(body);
  setAuthCookies(
    response,
    result.tokens.accessToken,
    result.tokens.refreshToken,
  );
  response.status(201).json({ data: result.user });
};

export const login: RequestHandler = async (request, response) => {
  const { body } = request.validated as LoginRequest;
  const result = await service.login(body.email, body.password);
  setAuthCookies(
    response,
    result.tokens.accessToken,
    result.tokens.refreshToken,
  );
  response.json({ data: result.user });
};

export const refresh: RequestHandler = async (request, response) => {
  const refreshToken = getCookie(request, "triage_refresh");
  if (!refreshToken) throw unauthorized("The refresh credential is missing");
  const result = await service.refresh(refreshToken);
  setAuthCookies(
    response,
    result.tokens.accessToken,
    result.tokens.refreshToken,
  );
  response.json({ data: result.user });
};

export const logout: RequestHandler = async (request, response) => {
  await service.logout(getCookie(request, "triage_refresh"));
  clearAuthCookies(response);
  response.status(204).end();
};
