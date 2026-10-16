import type { Request, Response } from "express";
import { env, isProduction } from "../config/env.js";

export function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const common = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
  };
  response.cookie("triage_access", accessToken, {
    ...common,
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL
      ? durationToMs(env.ACCESS_TOKEN_TTL)
      : undefined,
  });
  response.cookie("triage_refresh", refreshToken, {
    ...common,
    path: "/api/auth",
    maxAge: durationToMs(env.REFRESH_TOKEN_TTL),
  });
}

export function clearAuthCookies(response: Response): void {
  const common = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
  };
  response.clearCookie("triage_access", { ...common, path: "/" });
  response.clearCookie("triage_refresh", { ...common, path: "/api/auth" });
}

function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return 0;
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * multipliers[match[2] as keyof typeof multipliers];
}
