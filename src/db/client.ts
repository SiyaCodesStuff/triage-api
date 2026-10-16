import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  logger.error(
    { errorName: error.name },
    "Unexpected idle PostgreSQL client error",
  );
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
