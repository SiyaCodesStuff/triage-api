export function assertSeedAllowed(
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): void {
  if (
    environment.NODE_ENV === "production" &&
    !args.includes("--allow-production")
  ) {
    throw new Error("Production seeding requires --allow-production");
  }
}
