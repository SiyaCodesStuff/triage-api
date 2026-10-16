import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env, durationToMilliseconds } from "../../config/env.js";
import { db } from "../../db/client.js";
import { refreshSessions, roles, users, type Role } from "../../db/schema.js";
import { conflict, unauthorized } from "../../lib/app-error.js";

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(roles),
  type: z.enum(["access", "refresh"]),
  jti: z.string().min(1),
});

const dummyPasswordHash = argon2.hash(randomBytes(32), {
  type: argon2.argon2id,
});

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
};

export type TokenPair = { accessToken: string; refreshToken: string };

function toSafeUser(user: typeof users.$inferSelect): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenPair(userId: string, role: Role): TokenPair {
  const accessToken = jwt.sign(
    { role, type: "access" },
    env.JWT_ACCESS_SECRET,
    {
      subject: userId,
      jwtid: randomUUID(),
      expiresIn: env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
      issuer: "triage-api",
      audience: "triage-api-client",
    },
  );
  const refreshToken = jwt.sign(
    { role, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    {
      subject: userId,
      jwtid: randomUUID(),
      expiresIn: env.REFRESH_TOKEN_TTL as SignOptions["expiresIn"],
      issuer: "triage-api",
      audience: "triage-api-client",
    },
  );
  return { accessToken, refreshToken };
}

function parseClaims(
  token: string,
  secret: string,
): z.infer<typeof claimsSchema> {
  const payload = jwt.verify(token, secret, {
    issuer: "triage-api",
    audience: "triage-api-client",
  });
  if (typeof payload === "string")
    throw unauthorized("The credential is invalid or expired");
  return claimsSchema.parse(payload as JwtPayload);
}

export function verifyAccessToken(token: string): {
  userId: string;
  role: Role;
} {
  const claims = parseClaims(token, env.JWT_ACCESS_SECRET);
  if (claims.type !== "access")
    throw unauthorized("The access credential is invalid or expired");
  return { userId: claims.sub, role: claims.role };
}

async function storeRefreshSession(
  query: Pick<typeof db, "insert">,
  userId: string,
  refreshToken: string,
): Promise<void> {
  await query.insert(refreshSessions).values({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(
      Date.now() + durationToMilliseconds(env.REFRESH_TOKEN_TTL),
    ),
  });
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: SafeUser; tokens: TokenPair }> {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });
  try {
    return await db.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({
          name: input.name,
          email: input.email.trim().toLowerCase(),
          passwordHash,
          role: "USER",
        })
        .returning();
      if (!user) throw new Error("User insert did not return a row");

      const tokens = tokenPair(user.id, user.role);
      await storeRefreshSession(transaction, user.id, tokens.refreshToken);
      return { user: toSafeUser(user), tokens };
    });
  } catch (error) {
    const databaseError =
      error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof databaseError === "object" &&
      databaseError !== null &&
      "code" in databaseError &&
      databaseError.code === "23505"
    ) {
      throw conflict("An account with that email already exists");
    }
    throw error;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: SafeUser; tokens: TokenPair }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  const valid = user
    ? await argon2.verify(user.passwordHash, password)
    : await dummyPasswordHash.then((hash) => argon2.verify(hash, password));

  if (!user || !valid) throw unauthorized("Email or password is incorrect");

  const tokens = tokenPair(user.id, user.role);
  await storeRefreshSession(db, user.id, tokens.refreshToken);
  return { user: toSafeUser(user), tokens };
}

export async function refresh(
  refreshToken: string,
): Promise<{ user: SafeUser; tokens: TokenPair }> {
  let claims: z.infer<typeof claimsSchema>;
  try {
    claims = parseClaims(refreshToken, env.JWT_REFRESH_SECRET);
  } catch {
    throw unauthorized("The refresh credential is invalid or expired");
  }
  if (claims.type !== "refresh")
    throw unauthorized("The refresh credential is invalid or expired");

  return db.transaction(async (transaction) => {
    const [session] = await transaction
      .select()
      .from(refreshSessions)
      .where(
        and(
          eq(refreshSessions.tokenHash, hashToken(refreshToken)),
          isNull(refreshSessions.revokedAt),
          gt(refreshSessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("update");
    if (!session || session.userId !== claims.sub) {
      throw unauthorized("The refresh credential is invalid or expired");
    }

    const [revoked] = await transaction
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshSessions.id, session.id),
          isNull(refreshSessions.revokedAt),
        ),
      )
      .returning({ id: refreshSessions.id });
    if (!revoked)
      throw unauthorized("The refresh credential has already been used");

    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user)
      throw unauthorized("The account for this credential no longer exists");

    const tokens = tokenPair(user.id, user.role);
    await storeRefreshSession(transaction, user.id, tokens.refreshToken);
    return { user: toSafeUser(user), tokens };
  });
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const claims = parseClaims(refreshToken, env.JWT_REFRESH_SECRET);
    if (claims.type !== "refresh") return;
  } catch {
    return;
  }
  await db
    .update(refreshSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshSessions.tokenHash, hashToken(refreshToken)),
        isNull(refreshSessions.revokedAt),
      ),
    );
}
