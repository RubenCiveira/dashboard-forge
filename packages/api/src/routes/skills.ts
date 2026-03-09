import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { skills } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { eq, sql, desc } from "drizzle-orm";
import { deleteSkillFile, syncSkillsFromFiles } from "../services/markdown-sync.js";
import { importFromZip, importFromGitHubUrl } from "../services/importer.js";

export const skillsRouter = new Hono();

const listQuery = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /api/v1/skills */
skillsRouter.get("/", zValidator("query", listQuery), async (ctx) => {
  const { page, pageSize } = ctx.req.valid("query");
  const offset = (page - 1) * pageSize;

  const items = await db.select().from(skills).orderBy(desc(skills.createdAt)).limit(pageSize).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(skills);

  return ctx.json({ data: items.map(deserialize), total, page, pageSize });
});

/** GET /api/v1/skills/:id */
skillsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(skills).where(eq(skills.id, id)).get();
  if (!row) throw new NotFoundError("Skill", id);
  return ctx.json({ data: deserialize(row) });
});

/** DELETE /api/v1/skills/:id */
skillsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const existing = await db.select().from(skills).where(eq(skills.id, id)).get();
  if (!existing) throw new NotFoundError("Skill", id);

  await db.delete(skills).where(eq(skills.id, id));
  deleteSkillFile(existing.name);

  return ctx.json({ data: { deleted: true } });
});

/** POST /api/v1/skills/sync — re-scan data/skills/ and import new files */
skillsRouter.post("/sync", async (ctx) => {
  const imported = await syncSkillsFromFiles();
  return ctx.json({ data: { imported } });
});

/**
 * POST /api/v1/skills/import
 * multipart: field "file" (.zip)
 * JSON:      { "url": "https://github.com/…" }
 */
skillsRouter.post("/import", async (ctx) => {
  const ct = ctx.req.header("content-type") ?? "";

  let imported: number;
  if (ct.includes("multipart/form-data")) {
    const form = await ctx.req.parseBody();
    const file = form["file"] as File | undefined;
    if (!file) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing file field" } }, 400);
    imported = await importFromZip(await file.arrayBuffer(), "skills");
  } else {
    const body = await ctx.req.json<{ url?: string }>();
    if (!body.url) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing url" } }, 400);
    imported = await importFromGitHubUrl(body.url, "skills");
  }

  return ctx.json({ data: { imported } });
});

function deserialize(row: typeof skills.$inferSelect) {
  return { ...row, tags: JSON.parse(row.tags) as string[] };
}
