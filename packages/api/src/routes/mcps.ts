import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { mcps } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { NotFoundError } from "../lib/errors.js";

export const mcpsRouter = new Hono();

const createBody = z.object({
  name:    z.string().min(1).max(100),
  type:    z.enum(["local", "remote"]),
  config:  z.record(z.unknown()),
  enabled: z.boolean().default(true),
});

const updateBody = createBody.partial();

/** GET /api/v1/mcps */
mcpsRouter.get("/", async (ctx) => {
  const rows = await db.select().from(mcps);
  return ctx.json({ data: rows.map(deserialize) });
});

/** GET /api/v1/mcps/:id */
mcpsRouter.get("/:id", async (ctx) => {
  const row = await db.select().from(mcps).where(eq(mcps.id, ctx.req.param("id"))).get();
  if (!row) throw new NotFoundError("MCP", ctx.req.param("id"));
  return ctx.json({ data: deserialize(row) });
});

/** POST /api/v1/mcps */
mcpsRouter.post("/", zValidator("json", createBody), async (ctx) => {
  const body = ctx.req.valid("json");
  const now  = new Date().toISOString();
  const id   = randomUUID();

  await db.insert(mcps).values({
    id,
    name:         body.name,
    type:         body.type,
    config:       JSON.stringify(body.config),
    enabled:      body.enabled,
    healthStatus: "unknown",
    createdAt:    now,
    updatedAt:    now,
  });

  const created = await db.select().from(mcps).where(eq(mcps.id, id)).get();
  return ctx.json({ data: deserialize(created!) }, 201);
});

/** PATCH /api/v1/mcps/:id */
mcpsRouter.patch("/:id", zValidator("json", updateBody), async (ctx) => {
  const id   = ctx.req.param("id");
  const body = ctx.req.valid("json");
  const row  = await db.select().from(mcps).where(eq(mcps.id, id)).get();
  if (!row) throw new NotFoundError("MCP", id);

  const now = new Date().toISOString();
  await db.update(mcps).set({
    ...(body.name    !== undefined && { name: body.name }),
    ...(body.type    !== undefined && { type: body.type }),
    ...(body.config  !== undefined && { config: JSON.stringify(body.config) }),
    ...(body.enabled !== undefined && { enabled: body.enabled }),
    updatedAt: now,
  }).where(eq(mcps.id, id));

  const updated = await db.select().from(mcps).where(eq(mcps.id, id)).get();
  return ctx.json({ data: deserialize(updated!) });
});

/** DELETE /api/v1/mcps/:id */
mcpsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(mcps).where(eq(mcps.id, id)).get();
  if (!row) throw new NotFoundError("MCP", id);
  await db.delete(mcps).where(eq(mcps.id, id));
  return ctx.json({ data: { deleted: true } });
});

function deserialize(row: typeof mcps.$inferSelect) {
  return {
    ...row,
    config: JSON.parse(row.config) as Record<string, unknown>,
  };
}
