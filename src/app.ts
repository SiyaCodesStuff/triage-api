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
import { validateRequest } from "./middleware/validate-request.js";
import { authRouter } from "./modules/auth/routes.js";
import { commentsRouter } from "./modules/comments/routes.js";
import { ticketsRouter } from "./modules/tickets/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { z } from "zod";

const noRequestDataSchema = z.strictObject({
  body: z.strictObject({}).optional(),
  params: z.strictObject({}),
  query: z.strictObject({}),
});

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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
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
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "16kb", strict: true }));

app.get(
  "/openapi.json",
  validateRequest(noRequestDataSchema),
  (_request, response) => {
    response.json(openApiDocument);
  },
);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api", commentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
