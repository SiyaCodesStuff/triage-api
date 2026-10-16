import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/client.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "triage-api is listening");
});

const SHUTDOWN_TIMEOUT_MS = 10000;
let shuttingDown = false;
let shutdownExitCode = 0;

function shutdown(signal: string, exitCode: number): void {
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);
  if (shuttingDown) return;
  shuttingDown = true;

  const timeout = setTimeout(() => {
    logger.error({ signal }, "triage-api shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  server.close((error) => {
    void (async () => {
      try {
        if (error) throw error;
        await pool.end();
        logger.info({ signal }, "triage-api shut down");
        clearTimeout(timeout);
        process.exit(shutdownExitCode);
      } catch (err) {
        logger.error({ err, signal }, "triage-api shutdown failed");
        clearTimeout(timeout);
        process.exit(1);
      }
    })();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal, 0));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "triage-api unhandled rejection");
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "triage-api uncaught exception");
  shutdown("uncaughtException", 1);
});
