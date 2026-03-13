/**
 * Job dispatcher — background polling loop that picks up PENDING jobs and
 * executes them via the orchestrator, respecting the runner's maxConcurrent setting.
 *
 * maxConcurrent is read from the first active runner's config on every tick,
 * so changes take effect without restarting the server.
 *
 * On startup, any job left in RUNNING or WAITING_INPUT state is recovered:
 * - RUNNING + server still alive on saved port → reconnected to existing session.
 * - RUNNING/WAITING_INPUT + server dead but session history available → reset to
 *   PENDING with history injected as context so it resumes on the next tick.
 * - Otherwise → marked FAILED.
 */

import { eq, asc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { JOB_STATUS } from "@agentforge/shared";
import { executeJob, reconnectJob, resumeJobWithHistory } from "./orchestrator.js";

/** Checks whether an OpenCode server at the given port is reachable. */
async function isServerAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/session`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * On startup, find jobs left in RUNNING or WAITING_INPUT state.
 * - RUNNING + alive server → reconnect to existing session.
 * - RUNNING/WAITING_INPUT + dead server + has sessionId → resume with history.
 * - Otherwise → mark FAILED.
 */
async function recoverStaleJobs(): Promise<void> {
  const staleStatuses = [JOB_STATUS.RUNNING, JOB_STATUS.WAITING_INPUT] as const;

  for (const status of staleStatuses) {
    const stale = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, status));

    for (const job of stale) {
      // RUNNING jobs: check if the server process is still alive
      if (status === JOB_STATUS.RUNNING && job.serverPort) {
        const alive = await isServerAlive(job.serverPort);
        if (alive) {
          console.log(`[dispatcher] Reconnecting job ${job.id} to server on :${job.serverPort}`);
          reconnectJob(job).catch(async (err: unknown) => {
            console.error(`[dispatcher] Reconnect failed for job ${job.id}:`, err);
            // Server died between the liveness check and reconnect — try history replay
            if (job.sessionId) {
              resumeJobWithHistory(job).catch((e: unknown) => {
                console.error(`[dispatcher] Resume also failed for job ${job.id}:`, e);
                db.update(schema.jobs)
                  .set({ status: JOB_STATUS.FAILED, summary: "Failed to reconnect or resume", completedAt: new Date().toISOString() })
                  .where(eq(schema.jobs.id, job.id))
                  .catch(() => {});
              });
            } else {
              await db
                .update(schema.jobs)
                .set({ status: JOB_STATUS.FAILED, summary: "Reconnect failed (no session)", completedAt: new Date().toISOString(), pid: null, serverPort: null })
                .where(eq(schema.jobs.id, job.id));
            }
          });
          continue;
        }
      }

      // Server dead (or WAITING_INPUT): try history-based resume
      if (job.sessionId) {
        console.log(`[dispatcher] Resuming job ${job.id} with conversation history`);
        await resumeJobWithHistory(job).catch(async (err: unknown) => {
          console.error(`[dispatcher] Resume failed for job ${job.id}:`, err);
          await db
            .update(schema.jobs)
            .set({ status: JOB_STATUS.FAILED, summary: "Failed to resume with history", completedAt: new Date().toISOString(), pid: null, serverPort: null })
            .where(eq(schema.jobs.id, job.id));
        });
      } else {
        await db
          .update(schema.jobs)
          .set({
            status: JOB_STATUS.FAILED,
            summary: `Session lost (server restart while job was ${status})`,
            completedAt: new Date().toISOString(),
            pid: null,
            serverPort: null,
          })
          .where(eq(schema.jobs.id, job.id));
        console.log(`[dispatcher] Stale job ${job.id} (${status}) marked as failed`);
      }
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
