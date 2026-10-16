import { describe, expect, it } from "vitest";
import { pool, db } from "../db/client.js";
import { comments } from "../db/schema.js";
import { createUser, loginAs, createTicket } from "./helpers/index.js";

async function tableCounts() {
  const result = await pool.query<{
    count: number;
  }>(`SELECT count(*)::int AS count FROM users
    UNION ALL SELECT count(*)::int FROM tickets
    UNION ALL SELECT count(*)::int FROM comments
    UNION ALL SELECT count(*)::int FROM refresh_sessions`);
  return result.rows.map((row) => row.count);
}
describe("integration database isolation", () => {
  it("starts empty and exercises all shared helpers", async () => {
    expect(await tableCounts()).toEqual([0, 0, 0, 0]);
    const user = await createUser();
    const session = await loginAs(user);
    const ticket = await createTicket(user);
    const me = await session.agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
    await db
      .insert(comments)
      .values({
        ticketId: ticket.id,
        authorId: user.id,
        body: "Isolation fixture",
      });
    expect(await tableCounts()).toEqual([1, 1, 1, 1]);
  });
  it("truncates all application tables between tests", async () => {
    expect(await tableCounts()).toEqual([0, 0, 0, 0]);
  });
});
