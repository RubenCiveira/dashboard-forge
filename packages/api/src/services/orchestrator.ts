import { Subprocess } from "bun";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { eventBus } from "../lib/events.js";
import { materializePlaybook } from "./materializer.js";
import { JOB_STATUS, SSE_EVENT } from "@agentforge/shared";

/**
 * Executes a job by materializing its playbook and launching opencode run.
 * This is the core of the orchestration layer.
 */
export async function executeJob(jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) throw new Error(`Job ${jobId} not found`);

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, job.projectId));

  if (!project) throw new Error(`Project ${job.projectId} not found`);

  // Update status to RUNNING
  const now = new Date().toISOString();
  await db
    .update(schema.jobs)
    .set({ status: JOB_STATUS.RUNNING, startedAt: now })
    .where(eq(schema.jobs.id, jobId));

  eventBus.emit({
    type: SSE_EVENT.JOB_STARTED,
    data: { jobId, startedAt: now },
  });

  try {
    // 1. Materialize playbook as config directory
    const configDir = await materializePlaybook(
      job.playbookId,
      jobId,
      job.modelOverride,
    );

    // 2. Build the prompt (with context from parent job if in a pipeline)
    let fullPrompt = job.prompt;
    if (job.contextFrom) {
      fullPrompt = `## Context from previous step\n${job.contextFrom}\n\n## Your task\n${job.prompt}`;
    }

    // 3. Determine model and agent
    const model = job.modelOverride ?? project.defaultModel;
    const args = ["run", fullPrompt, "--model", model, "-f", "json", "-q"];

    if (job.agentOverride) {
      args.push("--agent", job.agentOverride);
    }

    // 4. Determine working directory
    const cwd = project.sourceType === "local"
      ? project.sourcePath
      : `data/workspaces/${project.id}`;

    // 5. Launch opencode as child process
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

    // 6. Capture output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      await db
        .update(schema.jobs)
        .set({
          status: JOB_STATUS.FAILED,
          summary: stderr || "Process exited with non-zero code",
          completedAt: new Date().toISOString(),
        })
        .where(eq(schema.jobs.id, jobId));

      eventBus.emit({
        type: SSE_EVENT.JOB_FAILED,
        data: { jobId, error: stderr },
      });

      await logJobEvent(jobId, "failed", { exitCode, stderr });
      return;
    }

    // 7. Extract summary from output
    let summary = stdout;
    try {
      const parsed = JSON.parse(stdout);
      summary = parsed.result ?? parsed.content ?? stdout;
    } catch {
      // stdout is not JSON, use raw text
    }

    // 8. Update job as completed
    await db
      .update(schema.jobs)
      .set({
        status: JOB_STATUS.COMPLETED,
        summary,
        completedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobs.id, jobId));

    eventBus.emit({
      type: SSE_EVENT.JOB_COMPLETED,
      data: { jobId, summary: summary.slice(0, 500) },
    });

    await logJobEvent(jobId, "completed", { summary: summary.slice(0, 1000) });

    // 9. Check for chained jobs (pipeline continuation)
    // TODO: In pipeline phase, check if there are pending jobs with parentJobId = jobId
    // and inject this job's summary as contextFrom

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(schema.jobs)
      .set({
        status: JOB_STATUS.FAILED,
        summary: message,
        completedAt: new Date().toISOString(),
      })
      .where(eq(schema.jobs.id, jobId));

    eventBus.emit({
      type: SSE_EVENT.JOB_FAILED,
      data: { jobId, error: message },
    });

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
