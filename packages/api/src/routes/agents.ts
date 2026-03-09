import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { NotFoundError } from "../lib/errors.js";
import {
  readAllAgents,
  readAgent,
  deleteAgentFile,
} from "../services/markdown-sync.js";
import { importFromZip, importFromGitHubUrl } from "../services/importer.js";

export const agentsRouter = new Hono();

const listQuery = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/v1/agents */
agentsRouter.get("/", zValidator("query", listQuery), (ctx) => {
  const { page, pageSize } = ctx.req.valid("query");
  const all    = readAllAgents();
  const offset = (page - 1) * pageSize;
  const items  = all.slice(offset, offset + pageSize);
  return ctx.json({ data: items, total: all.length, page, pageSize });
});

/** GET /api/v1/agents/:id */
agentsRouter.get("/:id", (ctx) => {
  const id  = ctx.req.param("id");
  const row = readAgent(id);
  if (!row) throw new NotFoundError("Agent", id);
  return ctx.json({ data: row });
});

/** DELETE /api/v1/agents/:id */
agentsRouter.delete("/:id", (ctx) => {
  const id  = ctx.req.param("id");
  const row = readAgent(id);
  if (!row) throw new NotFoundError("Agent", id);
  deleteAgentFile(id);
  return ctx.json({ data: { deleted: true } });
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
