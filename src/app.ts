import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { openApiDocument } from "./config/openapi.js";
import { pool } from "./db/client.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requireCsrf } from "./middleware/require-csrf.js";
import { validateRequest } from "./middleware/validate-request.js";
import { authRouter } from "./modules/auth/routes.js";
import { commentsRouter } from "./modules/comments/routes.js";
import { ticketsRouter } from "./modules/tickets/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { noRequestDataSchema } from "./config/openapi-schemas.js";

export const app = express();

app.set("trust proxy", env.TRUST_PROXY);

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url?.split("?")[0],
        remoteAddress: request.remoteAddress,
      }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
      },
    },
  }),
);
app.use(cors({ origin: env.CORS_ORIGINS ?? false, credentials: true }));
app.get("/health", (_request, response) => {
  response.json({ data: { status: "ok" } });
});
app.get("/ready", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ data: { status: "ready" } });
  } catch {
    response.status(503).json({
      error: { code: "NOT_READY", message: "The database is not available" },
    });
  }
});

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests; try again later",
      },
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "16kb", strict: true }));

if (env.ENABLE_DOCS) {
  app.get(
    "/openapi.json",
    validateRequest(noRequestDataSchema),
    (_request, response) => response.json(openApiDocument),
  );
  app.use(
    "/docs",
    helmet.contentSecurityPolicy({
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument),
  );
}

app.use("/api/v1", requireCsrf);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/tickets", ticketsRouter);
app.use("/api/v1", commentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
