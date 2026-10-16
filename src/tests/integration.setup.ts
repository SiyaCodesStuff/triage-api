const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_ACCESS_SECRET = "integration-test-access-secret-long-enough";
process.env.JWT_REFRESH_SECRET = "integration-test-refresh-secret-long-enough";
