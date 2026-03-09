import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { NotFoundError } from "../lib/errors.js";
import { deleteAgentFile, syncAgentsFromFiles } from "../services/markdown-sync.js";
import { importFromZip, importFromGitHubUrl } from "../services/importer.js";
import { z } from "zod";

export const agentsRouter = new Hono();

const listQuery = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/v1/agents */
agentsRouter.get("/", zValidator("query", listQuery), async (ctx) => {
  const { page, pageSize } = ctx.req.valid("query");
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(schema.agents)
    .limit(pageSize)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.agents);

  return ctx.json({ data: items.map(deserialize), total, page, pageSize });
});

/** GET /api/v1/agents/:id */
agentsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, id));
  if (!row) throw new NotFoundError("Agent", id);
  return ctx.json({ data: deserialize(row) });
});

/** DELETE /api/v1/agents/:id */
agentsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const [existing] = await db.select().from(schema.agents).where(eq(schema.agents.id, id));
  if (!existing) throw new NotFoundError("Agent", id);

  await db.delete(schema.agents).where(eq(schema.agents.id, id));
  deleteAgentFile(existing.name);

  return ctx.json({ data: { deleted: true } });
});

/** POST /api/v1/agents/sync — re-scan data/agents/ and import new files */
agentsRouter.post("/sync", async (ctx) => {
  const imported = await syncAgentsFromFiles();
  return ctx.json({ data: { imported } });
});

/**
 * POST /api/v1/agents/import
 * multipart: field "file" (.zip)
 * JSON:      { "url": "https://github.com/…" }
 */
agentsRouter.post("/import", async (ctx) => {
  const ct = ctx.req.header("content-type") ?? "";

  let imported: number;
  if (ct.includes("multipart/form-data")) {
    const form = await ctx.req.parseBody();
    const file = form["file"] as File | undefined;
    if (!file) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing file field" } }, 400);
    imported = await importFromZip(await file.arrayBuffer(), "agents");
  } else {
    const body = await ctx.req.json<{ url?: string }>();
    if (!body.url) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing url" } }, 400);
    imported = await importFromGitHubUrl(body.url, "agents");
  }

  return ctx.json({ data: { imported } });
});

function deserialize(row: typeof schema.agents.$inferSelect) {
  return {
    ...row,
    tools: JSON.parse(row.tools) as string[],
    tags:  JSON.parse(row.tags)  as string[],
  };
}
