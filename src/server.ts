import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/client.js";
import {
  createShutdownHandler,
  registerProcessHandlers,
} from "./lib/shutdown.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "triage-api is listening");
});

const shutdown = createShutdownHandler({
  server,
  closeResources: () => pool.end(),
  logger,
  exit: process.exit,
  timeoutMs: 10000,
});
registerProcessHandlers(process, shutdown, logger);
