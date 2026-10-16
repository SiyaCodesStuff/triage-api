export function assertTestDatabase(
  testDatabaseUrl: string | undefined,
  applicationDatabaseUrl: string | undefined,
): string {
  if (!testDatabaseUrl)
    throw new Error("TEST_DATABASE_URL is required for integration tests");
  const target = new URL(testDatabaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !/test/i.test(decodeURIComponent(target.pathname))
  )
    throw new Error(
      "Integration truncation requires a database name containing test",
    );
  if (applicationDatabaseUrl) {
    const application = new URL(applicationDatabaseUrl);
    if (
      application.hostname === target.hostname &&
      (application.port || "5432") === (target.port || "5432") &&
      application.pathname === target.pathname
    )
      throw new Error(
        "TEST_DATABASE_URL must not target the application database",
      );
  }
  return testDatabaseUrl;
}
