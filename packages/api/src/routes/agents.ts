import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, like, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { createAgentSchema, updateAgentSchema } from "@agentforge/shared";
import { NotFoundError } from "../lib/errors.js";
import { z } from "zod";

export const agentsRouter = new Hono();

const querySchema = z.object({
  search: z.string().optional(),
  tags: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** List agents with optional search and tag filtering */
agentsRouter.get("/", zValidator("query", querySchema), async (ctx) => {
  const { search, tags, page, pageSize } = ctx.req.valid("query");
  const offset = (page - 1) * pageSize;

  // Build conditions
  let query = db.select().from(schema.agents);

  // TODO: Add search and tag filtering with drizzle conditions
  // For MVP, return all with pagination
  const items = await db
    .select()
    .from(schema.agents)
    .limit(pageSize)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.agents);

  // Parse JSON fields before returning
  const data = items.map(deserializeAgent);

  return ctx.json({ data, total, page, pageSize });
});

/** Get a single agent by ID */
agentsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const [row] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id));

  if (!row) throw new NotFoundError("Agent", id);

  return ctx.json({ data: deserializeAgent(row) });
});

/** Create a new agent */
agentsRouter.post("/", zValidator("json", createAgentSchema), async (ctx) => {
  const input = ctx.req.valid("json");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.agents).values({
    id,
    name: input.name,
    description: input.description,
    markdownContent: input.markdownContent,
    tools: JSON.stringify(input.tools),
    model: input.model ?? null,
    tags: JSON.stringify(input.tags),
    source: input.source,
    version: input.version,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id));

  return ctx.json({ data: deserializeAgent(row!) }, 201);
});

/** Update an existing agent */
agentsRouter.put("/:id", zValidator("json", updateAgentSchema), async (ctx) => {
  const id = ctx.req.param("id");
  const input = ctx.req.valid("json");
  const now = new Date().toISOString();

  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id));

  if (!existing) throw new NotFoundError("Agent", id);

  const updateValues: Record<string, unknown> = { updatedAt: now };
  if (input.name !== undefined) updateValues.name = input.name;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.markdownContent !== undefined) updateValues.markdownContent = input.markdownContent;
  if (input.tools !== undefined) updateValues.tools = JSON.stringify(input.tools);
  if (input.model !== undefined) updateValues.model = input.model;
  if (input.tags !== undefined) updateValues.tags = JSON.stringify(input.tags);
  if (input.source !== undefined) updateValues.source = input.source;
  if (input.version !== undefined) updateValues.version = input.version;

  await db
    .update(schema.agents)
    .set(updateValues)
    .where(eq(schema.agents.id, id));

  const [row] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id));

  return ctx.json({ data: deserializeAgent(row!) });
});

/** Delete an agent */
agentsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");

  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id));

  if (!existing) throw new NotFoundError("Agent", id);

  await db.delete(schema.agents).where(eq(schema.agents.id, id));

  return ctx.json({ data: { deleted: true } });
});

/** Deserialize JSON string fields from SQLite into proper arrays */
function deserializeAgent(row: typeof schema.agents.$inferSelect) {
  return {
    ...row,
    tools: JSON.parse(row.tools) as string[],
    tags: JSON.parse(row.tags) as string[],
  };
}
