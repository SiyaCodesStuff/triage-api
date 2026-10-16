const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for test database migrations");
}

process.env.DATABASE_URL = testDatabaseUrl;
await import("./migrate.js");
