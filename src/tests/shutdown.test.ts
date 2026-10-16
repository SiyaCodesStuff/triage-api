import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShutdownHandler,
  registerProcessHandlers,
} from "../lib/shutdown.js";

function fixture() {
  let completeClose: (error?: Error) => void = () => {
    throw new Error("Server close has not started");
  };
  const server = {
    close: vi.fn((callback: (error?: Error) => void) => {
      completeClose = callback;
    }),
  };
  const pool = { end: vi.fn(async () => undefined) };
  const logger = { info: vi.fn(), error: vi.fn() };
  const exit = vi.fn<(code: number) => void>();
  const handler = createShutdownHandler({
    server,
    closeResources: pool.end,
    logger,
    exit,
    timeoutMs: 10000,
  });
  return {
    server,
    pool,
    logger,
    exit,
    handler,
    finish: (error?: Error) => completeClose(error),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("shutdown handler", () => {
  it("stops accepting connections, closes resources, logs once, exits zero and clears an unreferenced timer", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    const f = fixture();
    const done = f.handler("SIGTERM");
    expect(f.server.close).toHaveBeenCalledTimes(1);
    expect(f.pool.end).not.toHaveBeenCalled();
    expect(f.exit).not.toHaveBeenCalled();
    expect((timer.mock.results[0].value as NodeJS.Timeout).hasRef()).toBe(
      false,
    );
    f.finish();
    await done;
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.logger.info).toHaveBeenCalledExactlyOnceWith(
      { signal: "SIGTERM" },
      "triage-api shut down",
    );
    expect(f.logger.error).not.toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.exit).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated signals while the server is closing and after completion", async () => {
    const f = fixture();
    const done = f.handler("SIGTERM");
    await f.handler("SIGINT");
    expect(f.server.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    f.finish();
    await done;
    await f.handler("SIGTERM");
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.logger.info).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("forces exit one if server.close never completes", async () => {
    const f = fixture();
    void f.handler("SIGINT");
    await vi.advanceTimersByTimeAsync(9999);
    expect(f.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
      { signal: "SIGINT" },
      "triage-api shutdown timed out",
    );
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.pool.end).not.toHaveBeenCalled();
  });

  it("also times out while resource closure is pending", async () => {
    const f = fixture();
    f.pool.end.mockImplementation(() => new Promise(() => {}));
    void f.handler("SIGTERM");
    f.finish();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.logger.error).toHaveBeenCalledWith(
      { signal: "SIGTERM" },
      "triage-api shutdown timed out",
    );
  });

  it.each(["callback", "throw"])(
    "exits one and clears the timer if server.close fails via %s",
    async (failure) => {
      const f = fixture();
      const err = new Error("Close failed");
      if (failure === "throw")
        f.server.close.mockImplementation(() => {
          throw err;
        });
      const done = f.handler("SIGTERM");
      if (failure === "callback") f.finish(err);
      await done;
      expect(f.pool.end).not.toHaveBeenCalled();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
        { err, signal: "SIGTERM" },
        "triage-api shutdown failed",
      );
      expect(f.logger.info).not.toHaveBeenCalled();
      expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("exits one and clears the timer if closeResources rejects", async () => {
    const f = fixture();
    const err = new Error("Resources failed");
    f.pool.end.mockRejectedValue(err);
    const done = f.handler("SIGINT");
    f.finish();
    await done;
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
      { err, signal: "SIGINT" },
      "triage-api shutdown failed",
    );
    expect(f.logger.info).not.toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("process handler registration", () => {
  it.each(["SIGINT", "SIGTERM"])(
    "wires %s to graceful shutdown",
    async (signal) => {
      const proc = new EventEmitter();
      const f = fixture();
      const handler = vi.fn(f.handler);
      registerProcessHandlers(proc, handler, f.logger);
      proc.emit(signal);
      expect(handler).toHaveBeenCalledExactlyOnceWith(signal);
      f.finish();
      await handler.mock.results[0].value;
      expect(f.exit).toHaveBeenCalledExactlyOnceWith(0);
    },
  );

  it.each(["unhandledRejection", "uncaughtException"])(
    "logs %s and shuts down with exit one",
    async (signal) => {
      const proc = new EventEmitter();
      const f = fixture();
      const handler = vi.fn(f.handler);
      registerProcessHandlers(proc, handler, f.logger);
      const err = new Error("Fatal failure");
      proc.emit(signal, err);
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
        { err },
        signal === "unhandledRejection"
          ? "triage-api unhandled rejection"
          : "triage-api uncaught exception",
      );
      expect(handler).toHaveBeenCalledExactlyOnceWith(signal, 1);
      f.finish();
      await handler.mock.results[0].value;
      expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(f.logger.info).toHaveBeenCalledWith(
        { signal },
        "triage-api shut down",
      );
    },
  );

  it("escalates a pending graceful shutdown on fatal error without closing twice or losing the first signal", async () => {
    const proc = new EventEmitter();
    const f = fixture();
    const handler = vi.fn(f.handler);
    registerProcessHandlers(proc, handler, f.logger);
    proc.emit("SIGTERM");
    proc.emit("unhandledRejection", new Error("Fatal during shutdown"));
    proc.emit("SIGINT");
    expect(f.server.close).toHaveBeenCalledTimes(1);
    f.finish();
    await handler.mock.results[0].value;
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.logger.info).toHaveBeenCalledExactlyOnceWith(
      { signal: "SIGTERM" },
      "triage-api shut down",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
