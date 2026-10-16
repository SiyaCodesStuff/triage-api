import { z } from "./zod.js";

export const paginationQuery = {
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(Math.floor(Number.MAX_SAFE_INTEGER / 100))
    .default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export function getPagination({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}) {
  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    meta: (total: number) => ({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }),
  };
}
