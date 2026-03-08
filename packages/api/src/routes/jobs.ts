import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { JOB_STATUS } from "@agentforge/shared";

export const jobsRouter = new Hono();

const createJobBody = z.object({
  prompt: z.string().min(1),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const listQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  status: z.string().optional(),
});

/** GET /api/v1/jobs?project_id=X — List jobs, optionally filtered by project */
jobsRouter.get("/", zValidator("query", listQuerySchema), async (ctx) => {
  const { project_id, status } = ctx.req.valid("query");

  let query = db.select().from(jobs).orderBy(desc(jobs.createdAt)).$dynamic();

  if (project_id) {
    query = query.where(eq(jobs.projectId, project_id));
  }

  const rows = await query;
  return ctx.json({ data: rows });
});

/** GET /api/v1/jobs/:id — Get a single job */
jobsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new NotFoundError("Job", id);
  return ctx.json({ data: row });
});

/** POST /api/v1/jobs — Create a new job (direct agent task) */
jobsRouter.post(
  "/",
  zValidator("json", createJobBody),
  async (ctx) => {
    const body = ctx.req.valid("json");
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.insert(jobs).values({
      id,
      prompt: body.prompt,
      projectId: body.projectId,
      agentId: body.agentId,
      modelOverride: body.modelOverride ?? null,
      status: JOB_STATUS.PENDING,
      createdAt: now,
    });

    const created = await db.select().from(jobs).where(eq(jobs.id, id)).get();
    return ctx.json({ data: created }, 201);
  },
);

/** POST /api/v1/jobs/:id/cancel — Cancel a pending or running job */
jobsRouter.post("/:id/cancel", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new NotFoundError("Job", id);

  await db
    .update(jobs)
    .set({ status: JOB_STATUS.CANCELLED, completedAt: new Date().toISOString() })
    .where(eq(jobs.id, id));

  const updated = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  return ctx.json({ data: updated });
});
