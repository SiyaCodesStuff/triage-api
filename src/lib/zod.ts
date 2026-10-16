import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Zod 4 schemas must be constructed after the OpenAPI extension is installed.
extendZodWithOpenApi(z);
export { z };
