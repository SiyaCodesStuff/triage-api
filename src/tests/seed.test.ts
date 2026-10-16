import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "../lib/seed-production-guard.js";
import { readSeedConfiguration } from "../db/seed.js";

describe("admin seed configuration", () => {
  const valid = {
    ADMIN_EMAIL: " Admin@Example.Test ",
    ADMIN_PASSWORD: "1234567890",
  };
  it("checks production permission without credentials or side effects", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" }, [])).toThrow(
      "Production seeding requires --allow-production",
    );
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production" }, ["--allow-production"]),
    ).not.toThrow();
    expect(() => assertSeedAllowed({}, [])).not.toThrow();
  });
  it("requires an explicit flag in production", () => {
    expect(() =>
      readSeedConfiguration({ ...valid, NODE_ENV: "production" }, []),
    ).toThrow("--allow-production");
    expect(
      readSeedConfiguration({ ...valid, NODE_ENV: "production" }, [
        "--allow-production",
      ]).ADMIN_EMAIL,
    ).toBe("admin@example.test");
  });
  it.each([
    {},
    { ...valid, ADMIN_PASSWORD: "123456789" },
    { ...valid, ADMIN_EMAIL: "invalid" },
  ])(
    "rejects missing or invalid configuration without exposing values (case %#)",
    (environment) => {
      expect(() => readSeedConfiguration(environment, [])).toThrow(
        "Valid ADMIN_EMAIL and ADMIN_PASSWORD",
      );
    },
  );
  it("the CLI refuses production before requiring database credentials", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/db/seed.ts"],
      {
        env: { NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 25000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Admin seed failed");
  }, 30000);
});
