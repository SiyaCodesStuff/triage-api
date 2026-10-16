import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Database } from "./client.js";
import { assertSeedAllowed } from "../lib/seed-production-guard.js";

const seedSchema = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  ADMIN_PASSWORD: z.string().min(10).max(128),
});
export type SeedConfiguration = z.infer<typeof seedSchema>;

export function readSeedConfiguration(
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): SeedConfiguration {
  assertSeedAllowed(environment, args);
  const parsed = seedSchema.safeParse(environment);
  if (!parsed.success)
    throw new Error(
      "Valid ADMIN_EMAIL and ADMIN_PASSWORD (10–128 characters) are required",
    );
  return parsed.data;
}

export async function seedAdmin(
  database: Database,
  configuration: SeedConfiguration,
): Promise<"created" | "existing"> {
  const [{ default: argon2 }, { eq, sql }, { users }] = await Promise.all([
    import("argon2"),
    import("drizzle-orm"),
    import("./schema.js"),
  ]);
  const email = configuration.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await argon2.hash(configuration.ADMIN_PASSWORD, {
    type: argon2.argon2id,
  });
  // Conflict handling also makes concurrent seed invocations idempotent.
  const inserted = await database
    .insert(users)
    .values({
      name: "Administrator",
      email,
      passwordHash,
      role: "ADMIN",
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (inserted.length) return "created";
  const [existing] = await database
    .select({ role: users.role })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  if (existing?.role !== "ADMIN")
    throw new Error(
      "Configured admin email belongs to a non-admin account; refusing to promote it",
    );
  return "existing";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    // Validate the production guard and inputs before opening a database pool.
    const configuration = readSeedConfiguration(
      process.env,
      process.argv.slice(2),
    );
    const { db, pool } = await import("./client.js");
    try {
      const result = await seedAdmin(db, configuration);
      console.info(
        result === "created"
          ? "Admin created"
          : "Admin already exists; unchanged",
      );
    } finally {
      await pool.end();
    }
  } catch {
    // Database errors may contain query parameters; never print them.
    console.error(
      "Admin seed failed: check seed configuration, production flag, account role and database availability",
    );
    process.exitCode = 1;
  }
}
