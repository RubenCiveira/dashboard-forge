import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { NotFoundError } from "../lib/errors.js";
import {
  readAllPlaybooks,
  readPlaybook,
  deletePlaybookFile,
  updatePlaybookFile,
} from "../services/markdown-sync.js";
import { importFromZip, importFromGitHubUrl } from "../services/importer.js";

export const playbooksRouter = new Hono();

/** GET /api/v1/playbooks */
playbooksRouter.get("/", (ctx) => {
  return ctx.json({ data: readAllPlaybooks() });
});

/** GET /api/v1/playbooks/:id */
playbooksRouter.get("/:id", (ctx) => {
  const id  = ctx.req.param("id");
  const row = readPlaybook(id);
  if (!row) throw new NotFoundError("Playbook", id);
  return ctx.json({ data: row });
});

const patchBody = z.object({
  agentIds:          z.array(z.string()).optional(),
  skillIds:          z.array(z.string()).optional(),
  mcpIds:            z.array(z.string()).optional(),
  agentsRules:       z.string().optional(),
  description:       z.string().optional(),
  permissionProfile: z.enum(["autonomous", "assisted", "restrictive"]).optional(),
});

/** PATCH /api/v1/playbooks/:id */
playbooksRouter.patch("/:id", zValidator("json", patchBody), (ctx) => {
  const id   = ctx.req.param("id");
  const body = ctx.req.valid("json");
  const updated = updatePlaybookFile(id, body);
  if (!updated) throw new NotFoundError("Playbook", id);
  return ctx.json({ data: updated });
});

/** DELETE /api/v1/playbooks/:id */
playbooksRouter.delete("/:id", (ctx) => {
  const id  = ctx.req.param("id");
  const row = readPlaybook(id);
  if (!row) throw new NotFoundError("Playbook", id);
  deletePlaybookFile(id);
  return ctx.json({ data: { deleted: true } });
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
 *   agents: agent-slug-1, agent-slug-2
 *   skills: skill-slug-1
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
