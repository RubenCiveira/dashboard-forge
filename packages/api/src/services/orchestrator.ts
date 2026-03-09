import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { eventBus } from "../lib/events.js";
import { materializePlaybook } from "./materializer.js";
import { JOB_STATUS, SSE_EVENT } from "@agentforge/shared";

/**
 * Resolves the model to use for a job.
 * Priority: job.modelOverride → project.defaultModel → runner.defaultModel → hardcoded fallback.
 */
async function resolveModel(
  jobModelOverride: string | null | undefined,
  projectDefaultModel: string,
): Promise<string> {
  if (jobModelOverride) return jobModelOverride;
  if (projectDefaultModel) return projectDefaultModel;

  // Fallback: first enabled runner's defaultModel
  const runner = await db.select().from(schema.runners).limit(1).get();
  if (runner) {
    const cfg = JSON.parse(runner.config) as { defaultModel?: string };
    if (cfg.defaultModel) return cfg.defaultModel;
  }

  return "anthropic/claude-sonnet-4-5";
}

/**
 * Executes a job by materializing its playbook and launching opencode run.
 * This is the core of the orchestration layer.
 */
export async function executeJob(jobId: string): Promise<void> {
  const job = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .get();

  if (!job) throw new Error(`Job ${jobId} not found`);

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, job.projectId))
    .get();

  if (!project) throw new Error(`Project ${job.projectId} not found`);

  // Mark as RUNNING
  const now = new Date().toISOString();
  await db
    .update(schema.jobs)
    .set({ status: JOB_STATUS.RUNNING, startedAt: now })
    .where(eq(schema.jobs.id, jobId));

  eventBus.emit({ type: SSE_EVENT.JOB_STARTED, data: { jobId, startedAt: now } });

  try {
    // 1. Materialize playbook as OPENCODE_CONFIG_DIR
    const configDir = await materializePlaybook(
      job.playbookId!,
      jobId,
      job.modelOverride,
    );

    // 2. Build prompt (with parent context if chained)
    let fullPrompt = job.prompt;
    if (job.contextFrom) {
      fullPrompt = `## Context from previous step\n${job.contextFrom}\n\n## Your task\n${job.prompt}`;
    }

    // 3. Resolve model
    const model = await resolveModel(job.modelOverride, project.defaultModel);

    // 4. Build opencode CLI args
    const args = ["run", fullPrompt, "--model", model, "--format", "json"];
    if (job.agentOverride) args.push("--agent", job.agentOverride);

    // 5. Working directory
    const cwd = project.sourceType === "local"
      ? project.sourcePath
      : `data/workspaces/${project.id}`;

    // 6. Launch opencode
    const proc = Bun.spawn(["opencode", ...args], {
      cwd,
      env: {
        ...process.env,
        ...JSON.parse(project.envVars),
        OPENCODE_CONFIG_DIR: configDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Store PID immediately so the process can be tracked across restarts
    await db
      .update(schema.jobs)
      .set({ pid: proc.pid })
      .where(eq(schema.jobs.id, jobId));

    const stdout   = await new Response(proc.stdout).text();
    const stderr   = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      await db
        .update(schema.jobs)
        .set({ status: JOB_STATUS.FAILED, summary: [stderr, stdout].filter(Boolean).join("\n---\n") || `exit code ${exitCode}`, completedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, jobId));

      eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId, error: stderr } });
      await logJobEvent(jobId, "failed", { exitCode, stderr });
      return;
    }

    // 7. Extract summary
    let summary = stdout;
    try {
      const parsed = JSON.parse(stdout);
      summary = parsed.result ?? parsed.content ?? stdout;
    } catch { /* use raw text */ }

    // 8. Complete
    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.COMPLETED, summary, completedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId));

    eventBus.emit({ type: SSE_EVENT.JOB_COMPLETED, data: { jobId, summary: summary.slice(0, 500) } });
    await logJobEvent(jobId, "completed", { summary: summary.slice(0, 1000) });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.FAILED, summary: message, completedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId));

    eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId, error: message } });
    await logJobEvent(jobId, "error", { message });
  }
}

/** Record an event in the job_events table */
async function logJobEvent(
  jobId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.jobEvents).values({
    id: crypto.randomUUID(),
    jobId,
    eventType,
    payload: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  });
}
