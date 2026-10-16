process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgres://triage:triage@localhost:5432/triage_test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-long-enough";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-different";
