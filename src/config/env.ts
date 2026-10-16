import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .url()
      .refine((value) =>
        ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      ),
    TEST_DATABASE_URL: z
      .url()
      .refine((value) =>
        ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      )
      .optional(),
    POSTGRES_USER: z.string().min(1).default("triage"),
    POSTGRES_PASSWORD: z.string().min(1).default("triage"),
    POSTGRES_DB: z.string().min(1).default("triage"),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: z
      .string()
      .regex(/^\d+[smhd]$/)
      .default("15m"),
    REFRESH_TOKEN_TTL: z
      .string()
      .regex(/^\d+[smhd]$/)
      .default("7d"),
    CORS_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()))
      .optional(),
  })
  .refine(
    (configuration) =>
      configuration.JWT_ACCESS_SECRET !== configuration.JWT_REFRESH_SECRET,
    {
      path: ["JWT_REFRESH_SECRET"],
      message: "must be different from the access token secret",
    },
  );

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidKeys = parsedEnvironment.error.issues
    .map((issue) => String(issue.path[0]))
    .filter((key, index, keys) => keys.indexOf(key) === index);
  throw new Error(
    `Invalid environment configuration: ${invalidKeys.join(", ")}`,
  );
}

export const env = parsedEnvironment.data;
export const isProduction = env.NODE_ENV === "production";

export function durationToMilliseconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error("Invalid duration configuration");
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    unit as "s" | "m" | "h" | "d"
  ];
  return value * multiplier;
}
