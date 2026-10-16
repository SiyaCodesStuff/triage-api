import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "./helpers/database.js";

describe("integration truncation safety", () => {
  it("accepts an explicit separate test database", () => {
    const url = "postgres://localhost/triage_test";
    expect(assertTestDatabase(url, "postgres://localhost/triage")).toBe(url);
  });
  it("refuses an absent test target", () => {
    expect(() => assertTestDatabase(undefined, undefined)).toThrow(
      "TEST_DATABASE_URL",
    );
  });
  it("refuses database names without test and non-PostgreSQL targets", () => {
    expect(() =>
      assertTestDatabase("postgres://localhost/triage", undefined),
    ).toThrow("database name containing test");
    expect(() =>
      assertTestDatabase("https://localhost/triage_test", undefined),
    ).toThrow("database name containing test");
  });
  it("refuses the application database even through equivalent default ports or different credentials", () => {
    expect(() =>
      assertTestDatabase(
        "postgres://test_user@localhost:5432/triage_test",
        "postgres://app_user@localhost/triage_test",
      ),
    ).toThrow("must not target the application database");
  });
});
