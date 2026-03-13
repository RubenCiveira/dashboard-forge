/**
 * Job dispatcher — background polling loop that picks up PENDING jobs and
 * executes them via the orchestrator, respecting the runner's maxConcurrent setting.
 *
 * maxConcurrent is read from the first active runner's config on every tick,
 * so changes take effect without restarting the server.
 *
 * On startup, any job left in RUNNING state whose PID is no longer alive is
 * marked FAILED (the opencode process was killed when the server restarted).
 */

import { eq, asc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { JOB_STATUS } from "@agentforge/shared";
import { executeJob } from "./orchestrator.js";

/**
 * On startup, find jobs left in RUNNING state.
 * If their PID is no longer alive, mark them FAILED.
 */
async function recoverStaleJobs(): Promise<void> {
  // Jobs left in RUNNING or WAITING_INPUT after a restart have lost their
  // in-memory OpenCode session and can never complete — mark them failed.
  const staleStatuses = [JOB_STATUS.RUNNING, JOB_STATUS.WAITING_INPUT] as const;

  for (const status of staleStatuses) {
    const stale = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, status));

    for (const job of stale) {
      await db
        .update(schema.jobs)
        .set({
          status:      JOB_STATUS.FAILED,
          summary:     `Session lost (server restart while job was ${status})`,
          completedAt: new Date().toISOString(),
          pid:         null,
        })
        .where(eq(schema.jobs.id, job.id));

      console.log(`[dispatcher] Stale job ${job.id} (${status}) marked as failed`);
    }
  }
}

/** Set of job IDs currently being executed in this process */
const running = new Set<string>();

/** Read maxConcurrent from the first enabled runner (default: 1) */
async function getMaxConcurrent(): Promise<number> {
  const runner = await db
    .select()
    .from(schema.runners)
    .where(eq(schema.runners.enabled, true))
    .limit(1)
    .get();

  if (!runner) return 1;
  const cfg = JSON.parse(runner.config) as { maxConcurrent?: number };
  return Math.max(1, cfg.maxConcurrent ?? 1);
}

/** Single dispatch tick — fills available slots with pending jobs */
async function tick(): Promise<void> {
  const maxConcurrent = await getMaxConcurrent();
  const available = maxConcurrent - running.size;
  if (available <= 0) return;

  const pending = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, JOB_STATUS.PENDING))
    .orderBy(asc(schema.jobs.createdAt))
    .limit(available);

  for (const job of pending) {
    if (running.has(job.id)) continue;
    running.add(job.id);

    executeJob(job.id)
      .catch((err: unknown) => {
        console.error(`[dispatcher] Job ${job.id} error:`, err);
      })
      .finally(() => {
        running.delete(job.id);
      });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the dispatcher. Recovers stale jobs first, then polls every 3 s. */
export async function startDispatcher(): Promise<void> {
  if (timer !== null) return;

  await recoverStaleJobs();

  tick().catch(console.error);
  timer = setInterval(() => { tick().catch(console.error); }, 3000);
  console.log("✓ Job dispatcher started");
}

/** Stop the dispatcher (graceful shutdown). */
export function stopDispatcher(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Immediately releases the concurrency slot for a job.
 * Call this when a job is cancelled externally (e.g. via HTTP) so the
 * dispatcher can pick up the next pending job without waiting for the
 * in-flight executeJob promise to resolve.
 */
export function releaseJobSlot(jobId: string): void {
  running.delete(jobId);
}
