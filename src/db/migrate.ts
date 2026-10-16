import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";
import { logger } from "../config/logger.js";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Database migrations completed");
} catch (error) {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Database migration failed",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
