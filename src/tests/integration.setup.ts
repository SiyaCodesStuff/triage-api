import { afterAll, afterEach, beforeEach } from "vitest";
import { assertTestDatabase } from "./helpers/database.js";

const testDatabaseUrl = assertTestDatabase(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
);
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_ACCESS_SECRET = "integration-test-access-secret-long-enough";
process.env.JWT_REFRESH_SECRET = "integration-test-refresh-secret-long-enough";

async function truncateTables() {
  const { pool } = await import("../db/client.js");
  await pool.query(
    'TRUNCATE TABLE "comments", "refresh_sessions", "tickets", "users" RESTART IDENTITY',
  );
}
beforeEach(truncateTables);
afterEach(truncateTables);
afterAll(async () => {
  const { pool } = await import("../db/client.js");
  await pool.end();
});
