import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { playbooks } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { deletePlaybookFile, syncPlaybooksFromFiles } from "../services/markdown-sync.js";
import { importFromZip, importFromGitHubUrl } from "../services/importer.js";

export const playbooksRouter = new Hono();

/** GET /api/v1/playbooks */
playbooksRouter.get("/", async (ctx) => {
  const rows = await db.select().from(playbooks).orderBy(desc(playbooks.createdAt));
  return ctx.json({ data: rows.map(deserialize) });
});

/** GET /api/v1/playbooks/:id */
playbooksRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!row) throw new NotFoundError("Playbook", id);
  return ctx.json({ data: deserialize(row) });
});

/** DELETE /api/v1/playbooks/:id */
playbooksRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const existing = await db.select().from(playbooks).where(eq(playbooks.id, id)).get();
  if (!existing) throw new NotFoundError("Playbook", id);

  await db.delete(playbooks).where(eq(playbooks.id, id));
  deletePlaybookFile(existing.name);

  return ctx.json({ data: { deleted: true } });
});

/** POST /api/v1/playbooks/sync — re-scan data/playbooks/ and import new files */
playbooksRouter.post("/sync", async (ctx) => {
  const imported = await syncPlaybooksFromFiles();
  return ctx.json({ data: { imported } });
});

/**
 * POST /api/v1/playbooks/import
 * multipart: field "file" (.zip)
 * JSON:      { "url": "https://github.com/…" }
 *
 * Playbook .md format:
 *   ---
 *   name: my-playbook
 *   description: Optional description
 *   permission_profile: autonomous | assisted | restrictive
 *   agents: agent-name-1, agent-name-2
 *   skills: skill-name-1
 *   ---
 *   # Work sequence
 *   1. …
 */
playbooksRouter.post("/import", async (ctx) => {
  const ct = ctx.req.header("content-type") ?? "";

  let imported: number;
  if (ct.includes("multipart/form-data")) {
    const form = await ctx.req.parseBody();
    const file = form["file"] as File | undefined;
    if (!file) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing file field" } }, 400);
    imported = await importFromZip(await file.arrayBuffer(), "playbooks");
  } else {
    const body = await ctx.req.json<{ url?: string }>();
    if (!body.url) return ctx.json({ error: { code: "BAD_REQUEST", message: "Missing url" } }, 400);
    imported = await importFromGitHubUrl(body.url, "playbooks");
  }

  return ctx.json({ data: { imported } });
});

function deserialize(row: typeof playbooks.$inferSelect) {
  return {
    ...row,
    permissions: JSON.parse(row.permissions) as Record<string, string>,
    agentIds:    JSON.parse(row.agentIds) as string[],
    skillIds:    JSON.parse(row.skillIds) as string[],
    mcpIds:      JSON.parse(row.mcpIds)   as string[],
  };
}
