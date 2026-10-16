import { readFileSync, readdirSync } from "node:fs";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { openApiDocument } from "../config/openapi.js";
import {
  registerRequestSchema,
  loginRequestSchema,
} from "../modules/auth/schemas.js";

type Document = typeof openApiDocument;
type Router = {
  stack: Array<{
    route?: { path: string | string[]; methods: Record<string, boolean> };
  }>;
};
type Mount = { parent: Router; path: string; child?: Router };
function join(prefix: string, path: string) {
  return `${prefix}/${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
function registeredRoutes(
  router: Router,
  mounts: Mount[],
  prefix = "",
): string[] {
  const routes: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path)
      ? layer.route.path
      : [layer.route.path];
    for (const path of paths)
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled)
          routes.push(
            `${method} ${join(prefix, path).replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
          );
      }
  }
  for (const mount of mounts.filter((entry) => entry.parent === router)) {
    if (mount.child)
      routes.push(
        ...registeredRoutes(mount.child, mounts, join(prefix, mount.path)),
      );
    // Swagger is middleware, not an Express Route. Cover its mount explicitly;
    // generated static assets are described by /docs/{assetPath} in the spec.
    else if (mount.path === "/docs")
      routes.push(`get ${join(prefix, mount.path)}`);
  }
  return [...new Set(routes)];
}
function documentedRoutes(document: Document): Set<string> {
  const result = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
      "trace",
    ] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      const servers = operation.servers ??
        item.servers ??
        document.servers ?? [{ url: "/" }];
      for (const server of servers)
        result.add(`${method} ${join(server.url, path)}`);
    }
  }
  return result;
}
function missingRoutes(router: Router, mounts: Mount[], document: Document) {
  const documented = documentedRoutes(document);
  return registeredRoutes(router, mounts).filter(
    (route) => !documented.has(route),
  );
}

describe("generated OpenAPI coverage", () => {
  let document: Document;
  let router: Router;
  let mounts: Mount[];
  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("ENABLE_DOCS", "true");
    const prototype = express.Router.prototype as {
      use: (...args: unknown[]) => unknown;
    };
    const use = vi.spyOn(prototype, "use");
    try {
      const { app } = await import("../app.js");
      document = (await import("../config/openapi.js")).openApiDocument;
      router = app.router as unknown as Router;
      mounts = [];
      for (const [i, args] of use.mock.calls.entries()) {
        const paths =
          typeof args[0] === "string"
            ? [args[0]]
            : Array.isArray(args[0]) &&
                args[0].every((path) => typeof path === "string")
              ? (args[0] as string[])
              : ["/"];
        const handlers =
          paths[0] === "/" && typeof args[0] !== "string"
            ? args
            : args.slice(1);
        for (const path of paths)
          for (const handler of handlers.flat(Infinity)) {
            const child = handler as Partial<Router> | undefined;
            mounts.push({
              parent: use.mock.contexts[i] as Router,
              path,
              ...(child?.stack ? { child: child as Router } : {}),
            });
          }
      }
    } finally {
      use.mockRestore();
    }
  }, 15000);
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("documents every registered method and mounted route at its actual URL", () => {
    const actual = registeredRoutes(router, mounts);
    expect(actual).toContain("post /api/v1/auth/register");
    expect(actual).toContain(
      "delete /api/v1/tickets/{ticketId}/comments/{commentId}",
    );
    expect(actual).toContain("get /health");
    expect(actual).toContain("get /docs");
    expect(missingRoutes(router, mounts, document)).toEqual([]);

    // Keep the runnable API collection in sync with all generated operations,
    // including the Swagger asset middleware represented by a parameterized path.
    const collection = new URL("../../docs/api-collection/", import.meta.url);
    const requests = readdirSync(collection)
      .filter((file) => file.endsWith(".bru"))
      .map((file) => {
        const source = readFileSync(new URL(file, collection), "utf8");
        const request = source.match(
          /^(get|post|patch|delete) \{\s+url: \{\{baseUrl\}\}([^\s?]+)/m,
        );
        expect(request, file).not.toBeNull();
        const [, method, path] = request!;
        if (["post", "patch", "delete"].includes(method))
          expect(source, file).toMatch(/X-CSRF-Protection: 1/);
        expect(source, file).toContain("tests {");
        const normalized = path.replace(/\{\{(\w+)\}\}/g, "{$1}");
        return `${method} ${normalized}`;
      });
    const documented = documentedRoutes(document);
    expect(requests.filter((route) => !documented.has(route))).toEqual([]);
    expect(
      [...documented].filter((route) => !requests.includes(route)),
    ).toEqual([]);
  });

  it("detects a newly registered undocumented route without changing a route list", () => {
    const child = express.Router();
    child.get("/:newId", (_req, res) => res.sendStatus(204));
    const childRouter = child as unknown as Router;
    const extended = [
      ...mounts,
      { parent: router, path: "/api/v1/undocumented", child: childRouter },
    ];
    expect(missingRoutes(router, extended, document)).toEqual([
      "get /api/v1/undocumented/{newId}",
    ]);
    const copy = structuredClone(document);
    delete copy.paths["/tickets/{ticketId}/comments/{commentId}"];
    expect(missingRoutes(router, mounts, copy)).toContain(
      "delete /api/v1/tickets/{ticketId}/comments/{commentId}",
    );
  });

  it("has schemas for every JSON success/error response and no content for 204", () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ["get", "post", "patch", "delete"] as const) {
        const operation = item?.[method];
        if (!operation) continue;
        expect(operation.operationId).toBeTruthy();
        for (const [status, response] of Object.entries(
          operation.responses ?? {},
        )) {
          if ("$ref" in response) continue;
          if (status === "204") expect(response.content).toBeUndefined();
          else if (!status.startsWith("3")) {
            expect(response.content).toBeDefined();
            for (const media of Object.values(response.content ?? {}))
              expect(media).toHaveProperty("schema");
          }
          if (Number(status) >= 400)
            expect(
              response.content?.["application/json"]?.schema,
            ).toHaveProperty("$ref");
        }
        const names = [
          ...(item.parameters ?? []),
          ...(operation.parameters ?? []),
        ].flatMap((parameter) =>
          "$ref" in parameter
            ? []
            : parameter.in === "path"
              ? [parameter.name]
              : [],
        );
        for (const match of path.matchAll(/\{([^}]+)\}/g)) {
          expect(names).toContain(match[1]);
        }
      }
    }
  });

  it("keeps runtime request validation bounds, defaults and strict body schemas in the generated components", () => {
    const schemas = document.components.schemas!;
    expect(schemas.registerBody).toMatchObject({
      additionalProperties: false,
      required: ["name", "email", "password"],
      properties: { password: { minLength: 10, maxLength: 128 } },
    });
    expect(
      registerRequestSchema.shape.body.shape.password.safeParse("123456789")
        .success,
    ).toBe(false);
    expect(
      registerRequestSchema.shape.body.shape.password.safeParse("1234567890")
        .success,
    ).toBe(true);
    expect(schemas.loginBody).toMatchObject({
      properties: { password: { minLength: 1, maxLength: 128 } },
    });
    expect(
      loginRequestSchema.shape.body.shape.password.safeParse("").success,
    ).toBe(false);
    expect(schemas.updateTicketBody).toMatchObject({
      minProperties: 1,
      additionalProperties: false,
    });
    const query = document.paths["/tickets"].get!.parameters!;
    expect(query).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "pageSize",
          in: "query",
          schema: expect.objectContaining({ default: 20, maximum: 100 }),
        }),
      ]),
    );
    expect(schemas.User).not.toHaveProperty("properties.passwordHash");
    expect(schemas.User).not.toHaveProperty("properties.password_hash");
  });

  it("resolves every local reference and security requirement", () => {
    function check(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (
        "$ref" in value &&
        typeof value.$ref === "string" &&
        value.$ref.startsWith("#/")
      ) {
        let target: unknown = document;
        for (const part of value.$ref.slice(2).split("/"))
          target = (target as Record<string, unknown>)?.[
            part.replace(/~1/g, "/").replace(/~0/g, "~")
          ];
        expect(target, value.$ref).toBeDefined();
      }
      for (const nested of Object.values(value)) check(nested);
    }
    check(document);
    const schemes = document.components.securitySchemes!;
    expect(Object.keys(schemes).sort()).toEqual([
      "accessCookie",
      "bearerAuth",
      "csrfHeader",
      "refreshCookie",
    ]);
    expect(document.paths["/auth/refresh"].post!.security).toEqual([
      { refreshCookie: [], csrfHeader: [] },
    ]);
    expect(document.paths["/tickets"].post!.security).toEqual([
      { accessCookie: [], csrfHeader: [] },
      { bearerAuth: [], csrfHeader: [] },
    ]);
    for (const item of Object.values(document.paths))
      for (const method of ["get", "post", "patch", "delete"] as const) {
        for (const requirement of item?.[method]?.security ?? [])
          for (const scheme of Object.keys(requirement))
            expect(schemes).toHaveProperty(scheme);
      }
  });
});
