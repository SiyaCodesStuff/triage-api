import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/client.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "triage-api is listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => {
        logger.info({ signal }, "triage-api shut down");
        process.exit(0);
      });
    });
  });
}
