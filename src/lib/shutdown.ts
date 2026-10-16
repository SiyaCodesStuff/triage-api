interface ShutdownLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
interface ShutdownServer {
  close(callback: (error?: Error) => void): unknown;
}
interface ProcessEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type ShutdownHandler = (
  signal: string,
  exitCode?: 0 | 1,
) => Promise<void>;

export function createShutdownHandler({
  server,
  closeResources,
  logger,
  exit,
  timeoutMs,
}: {
  server: ShutdownServer;
  closeResources: () => Promise<unknown>;
  logger: ShutdownLogger;
  exit: (code: number) => void;
  timeoutMs: number;
}): ShutdownHandler {
  let shuttingDown = false;
  let shutdownExitCode = 0;

  return async (signal, exitCode = 0) => {
    // A fatal event can escalate a pending graceful shutdown without closing twice.
    shutdownExitCode = Math.max(shutdownExitCode, exitCode);
    if (shuttingDown) return;
    shuttingDown = true;

    const timeout = setTimeout(() => {
      logger.error({ signal }, "triage-api shutdown timed out");
      exit(1);
    }, timeoutMs);
    timeout.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await closeResources();
      logger.info({ signal }, "triage-api shut down");
      clearTimeout(timeout);
      exit(shutdownExitCode);
    } catch (err) {
      logger.error({ err, signal }, "triage-api shutdown failed");
      clearTimeout(timeout);
      exit(1);
    }
  };
}

export function registerProcessHandlers(
  proc: ProcessEvents,
  handler: ShutdownHandler,
  logger: ShutdownLogger,
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    proc.on(signal, () => {
      void handler(signal);
    });
  }
  proc.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "triage-api unhandled rejection");
    void handler("unhandledRejection", 1);
  });
  proc.on("uncaughtException", (err) => {
    logger.error({ err }, "triage-api uncaught exception");
    void handler("uncaughtException", 1);
  });
}
