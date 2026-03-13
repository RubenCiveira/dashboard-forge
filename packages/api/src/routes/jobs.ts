import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { jobs, jobEvents } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { eq, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { JOB_STATUS, respondJobSchema } from "@agentforge/shared";
import { getOpenCodeSession } from "../services/opencode-session.js";
import { respondToJob } from "../services/orchestrator.js";
import { releaseJobSlot } from "../services/job-dispatcher.js";
import { ApiError } from "../lib/errors.js";

export const jobsRouter = new Hono();

const createJobBody = z.object({
  prompt: z.string().min(1),
  projectId: z.string().uuid(),
  playbookId: z.string().min(1),
});

const listQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  status: z.string().optional(),
});

/** GET /api/v1/jobs?project_id=X — List jobs, optionally filtered by project */
jobsRouter.get("/", zValidator("query", listQuerySchema), async (ctx) => {
  const { project_id } = ctx.req.valid("query");

  let query = db.select().from(jobs).orderBy(desc(jobs.createdAt)).$dynamic();

  if (project_id) {
    query = query.where(eq(jobs.projectId, project_id));
  }

  const rows = await query;
  return ctx.json({ data: rows });
});

/** GET /api/v1/jobs/:id — Get a single job with its events and OpenCode conversation */
jobsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new NotFoundError("Job", id);
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, id))
    .orderBy(asc(jobEvents.createdAt));
  const conversation = row.sessionId ? getOpenCodeSession(row.sessionId) : [];
  return ctx.json({ data: { ...row, events, conversation } });
});

/** POST /api/v1/jobs — Create a job linked to a playbook */
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
      playbookId: body.playbookId,
      status: JOB_STATUS.PENDING,
      createdAt: now,
    });

    const created = await db.select().from(jobs).where(eq(jobs.id, id)).get();
    return ctx.json({ data: created }, 201);
  },
);

/** POST /api/v1/jobs/:id/respond — Respond to a job waiting for human input */
jobsRouter.post(
  "/:id/respond",
  zValidator("json", respondJobSchema),
  async (ctx) => {
    const id = ctx.req.param("id");
    const body = ctx.req.valid("json");

    const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!row) throw new NotFoundError("Job", id);

    if (row.status !== JOB_STATUS.WAITING_INPUT) {
      throw new ApiError(
        "JOB_NOT_WAITING",
        `Job is not waiting for input (current status: ${row.status})`,
        400,
      );
    }

    try {
      await respondToJob(id, body.action, body.message);
    } catch (err) {
      throw new ApiError(
        "RESPOND_FAILED",
        err instanceof Error ? err.message : String(err),
        409,
      );
    }

    const updated = await db.select().from(jobs).where(eq(jobs.id, id)).get();
    return ctx.json({ data: updated });
  },
);

/** POST /api/v1/jobs/:id/cancel — Cancel a pending or running job, killing the process if alive */
jobsRouter.post("/:id/cancel", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new NotFoundError("Job", id);

  // Kill the opencode process if we have its PID
  if (row.pid) {
    try {
      process.kill(row.pid, "SIGTERM");
    } catch {
      // Process already gone — ignore
    }
  }

  await db
    .update(jobs)
    .set({ status: JOB_STATUS.CANCELLED, completedAt: new Date().toISOString() })
    .where(eq(jobs.id, id));

  // Free the concurrency slot immediately so the dispatcher can pick up the
  // next pending job without waiting for the in-flight executeJob to resolve.
  releaseJobSlot(id);

  const updated = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  return ctx.json({ data: updated });
});
