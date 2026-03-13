import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { eventBus } from "../lib/events.js";
import { acquireServer, touchServer } from "./opencode-pool.js";
import { JOB_STATUS, SSE_EVENT } from "@agentforge/shared";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { Permission } from "@opencode-ai/sdk";

// ─── In-memory state ─────────────────────────────────────────────────────────

interface ActiveSession {
  /** SDK client pointed at the job's OpenCode server */
  client: ReturnType<typeof createOpencodeClient>;
  /** OpenCode session ID */
  sessionId: string;
  /** Working directory passed as ?directory= to all SDK calls */
  directory: string;
  /** Base URL of the OpenCode server (for direct REST calls) */
  baseUrl: string;
}

/** Jobs currently streaming events from OpenCode */
const activeSessions = new Map<string, ActiveSession>();

/** Latest pending permission per job — cleared when the user responds */
const pendingPermissions = new Map<string, Permission>();

interface PendingQuestion {
  id: string;
  questions: Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }> }>;
}
/** Latest pending question per job — cleared when the user responds */
const pendingQuestions = new Map<string, PendingQuestion>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves the model to use for a job.
 * Priority: job.modelOverride → runner.defaultModel → null (OpenCode default).
 */
async function resolveModel(
  jobModelOverride: string | null | undefined,
): Promise<string | null> {
  if (jobModelOverride) return jobModelOverride;

  const runner = await db.select().from(schema.runners).limit(1).get();
  if (runner) {
    const cfg = JSON.parse(runner.config) as { defaultModel?: string };
    if (cfg.defaultModel) return cfg.defaultModel;
  }
  return null;
}

/**
 * Parses a "provider/model" string into the `{ providerID, modelID }` shape
 * expected by the OpenCode SDK prompt body.
 */
function parseModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf("/");
  if (slash === -1) return { providerID: "anthropic", modelID: model };
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

/** Persists a job event row to the database. */
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

// ─── Core execution ──────────────────────────────────────────────────────────

/**
 * Executes a job using an OpenCode server from the pool.
 * Subscribes to SSE events and drives the job through its lifecycle,
 * pausing at permission requests for human-in-the-loop confirmation.
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

  const now = new Date().toISOString();
  await db
    .update(schema.jobs)
    .set({ status: JOB_STATUS.RUNNING, startedAt: now })
    .where(eq(schema.jobs.id, jobId));
  eventBus.emit({ type: SSE_EVENT.JOB_STARTED, data: { jobId, startedAt: now } });

  try {
    // 1. Resolve model
    const model = await resolveModel(job.modelOverride);

    // 2. Acquire a server from the pool (starts one if not already running)
    const port = await acquireServer(job.playbookId!, model);
    const baseUrl = `http://127.0.0.1:${port}`;
    const client = createOpencodeClient({ baseUrl });

    // 3. Working directory
    const cwd = project.sourceType === "local"
      ? project.sourcePath
      : `data/workspaces/${project.id}`;

    // 4. Create OpenCode session for this project directory
    const sessionRes = await client.session.create({ query: { directory: cwd } });
    const sessionId = (sessionRes.data as { id: string }).id;

    // Persist session ID and register active session
    await db
      .update(schema.jobs)
      .set({ sessionId })
      .where(eq(schema.jobs.id, jobId));
    activeSessions.set(jobId, { client, sessionId, directory: cwd, baseUrl });

    // 5. Build prompt
    let fullPrompt = job.prompt;
    if (job.contextFrom) {
      fullPrompt = `## Context from previous step\n${job.contextFrom}\n\n## Your task\n${job.prompt}`;
    }

    // 6. Subscribe BEFORE sending the prompt — avoids a race where session.idle
    //    fires before we start listening and the job stalls in RUNNING forever.
    const sub = await client.event.subscribe({ query: { directory: cwd } });

    // 7. Send prompt — returns immediately, session starts working
    const parsedModel = model ? parseModel(model) : undefined;
    await client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: cwd },
      body: {
        parts: [{ type: "text", text: fullPrompt }],
        ...(parsedModel && { model: parsedModel }),
        ...(job.agentOverride && { agent: job.agentOverride }),
      },
    });

    console.log(`[job ${jobId}] Session ${sessionId} started on ${baseUrl}`);
    await logJobEvent(jobId, "session_started", { sessionId, baseUrl, cwd });

    for await (const raw of sub.stream) {
      const event = raw as { type: string; properties: Record<string, unknown> };
      if (!event?.type) continue;

      const props = event.properties as Record<string, unknown> & { sessionID?: string };
      if (props.sessionID && props.sessionID !== sessionId) continue; // skip other sessions

      // ── Agent asked a question (question tool) ─────────────────────────
      if (event.type === "question.asked") {
        type QuestionPayload = {
          id: string;
          questions: Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }> }>;
        };
        const q = props as unknown as QuestionPayload;
        pendingQuestions.set(jobId, { id: q.id, questions: q.questions });

        await db
          .update(schema.jobs)
          .set({ status: JOB_STATUS.WAITING_INPUT })
          .where(eq(schema.jobs.id, jobId));

        const questionText = q.questions.map((qu) => qu.question).join("\n");
        eventBus.emit({
          type: SSE_EVENT.JOB_WAITING,
          data: { jobId, question: questionText.slice(0, 500) },
        });
        await logJobEvent(jobId, "agent_question", {
          questionId: q.id,
          question: questionText.slice(0, 1000),
        });
        continue; // keep the loop alive — respondToJob("message") will resume
      }

      // ── Permission requested ───────────────────────────────────────────
      if (event.type === "permission.updated") {
        const permission = props as unknown as Permission;
        pendingPermissions.set(jobId, permission);

        await db
          .update(schema.jobs)
          .set({ status: JOB_STATUS.WAITING_INPUT })
          .where(eq(schema.jobs.id, jobId));

        eventBus.emit({
          type: SSE_EVENT.JOB_WAITING,
          data: {
            jobId,
            permissionId: permission.id,
            permissionType: permission.type,
            title: permission.title,
            metadata: permission.metadata,
          },
        });
        await logJobEvent(jobId, "permission_requested", {
          permissionId: permission.id,
          type: permission.type,
          title: permission.title,
        });
        continue;
      }

      // ── Session idle / status:idle — session has finished processing ───
      //    OpenCode emits either `session.idle` (older) or
      //    `session.status { status: { type: "idle" } }` (current).
      type StatusProps = { status?: { type?: string } };
      const isSessionIdle =
        event.type === "session.idle" ||
        (event.type === "session.status" &&
          (props as StatusProps).status?.type === "idle");

      if (isSessionIdle) {
        const currentJob = await db
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.id, jobId))
          .get();

        // Job was cancelled externally — stop and free the slot.
        if (currentJob?.status === JOB_STATUS.CANCELLED) break;

        // Fetch the session data to check for a completion summary.
        const sessionData = await client.session.get({
          path: { id: sessionId },
          query: { directory: cwd },
        });
        type SessionSummary = { summary?: { title?: string; body?: string } };
        const rawSummary =
          (sessionData.data as SessionSummary)?.summary?.body ??
          (sessionData.data as SessionSummary)?.summary?.title ??
          null;

        // If the job is still WAITING_INPUT and the agent hasn't produced a
        // final summary, it replied with a plain-text follow-up question.
        // Keep the loop alive so the user can answer via respondToJob.
        if (currentJob?.status === JOB_STATUS.WAITING_INPUT && !rawSummary) {
          continue;
        }

        const summary = rawSummary ?? "Session completed";

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

        touchServer(job.playbookId!, model);
        break;
      }

      // ── Session error ──────────────────────────────────────────────────
      if (event.type === "session.error") {
        // An error during WAITING_INPUT is the abort we triggered to unblock
        // the question tool — ignore it, the event loop stays alive and will
        // receive new events from the re-sent prompt.
        const errJob = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
        if (errJob?.status === JOB_STATUS.WAITING_INPUT) continue;

        type SessionError = { error?: { data?: { message?: string } } };
        const errMsg =
          (props as SessionError).error?.data?.message ?? "Unknown session error";

        await db
          .update(schema.jobs)
          .set({
            status: JOB_STATUS.FAILED,
            summary: errMsg,
            completedAt: new Date().toISOString(),
          })
          .where(eq(schema.jobs.id, jobId));

        eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId, error: errMsg } });
        await logJobEvent(jobId, "failed", { error: errMsg });
        break;
      }
    }
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

    eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId, error: message } });
    await logJobEvent(jobId, "error", { message });
  } finally {
    activeSessions.delete(jobId);
    pendingPermissions.delete(jobId);
    pendingQuestions.delete(jobId);
  }
}

// ─── Human-in-the-loop ───────────────────────────────────────────────────────

/**
 * Responds to an active job that is waiting for user input.
 *
 * - `approve`: resolves a pending permission as "once" (allow this time).
 * - `deny`: resolves a pending permission as "reject".
 * - `message`: sends a follow-up prompt to the running session.
 */
export async function respondToJob(
  jobId: string,
  action: "approve" | "deny" | "message",
  message?: string,
): Promise<void> {
  const session = activeSessions.get(jobId);
  if (!session) throw new Error(`No active session for job ${jobId}`);

  // When the user answers a structured question we keep the job in WAITING_INPUT
  // so the idle handler can check for a session summary before deciding to
  // complete the job (the agent may reply with another plain-text question).
  let keepWaiting = false;

  if (action === "approve" || action === "deny") {
    const permission = pendingPermissions.get(jobId);
    if (!permission) throw new Error(`No pending permission for job ${jobId}`);

    await session.client.postSessionIdPermissionsPermissionId({
      path: { id: session.sessionId, permissionID: permission.id },
      query: { directory: session.directory },
      body: { response: action === "approve" ? "once" : "reject" },
    });

    pendingPermissions.delete(jobId);

  } else if (action === "message") {
    if (!message?.trim()) throw new Error("message is required for action=message");

    const pq = pendingQuestions.get(jobId);

    // Always log the user's response as a job event so it's visible in the UI.
    await logJobEvent(jobId, "user_response", {
      message: message.slice(0, 1000),
      ...(pq ? { questionId: pq.id } : {}),
    });

    if (pq) {
      keepWaiting = true;
      pendingQuestions.delete(jobId);

      // OpenCode's `question` tool in headless server mode has no dedicated
      // answer endpoint — the TUI control queue is not populated (confirmed by
      // control.next timeout). The session is "busy" with the tool blocking it,
      // so we cannot inject a new message directly.
      //
      // Solution: abort the current (blocked) run, then re-send the user's
      // answer as the next user turn. The conversation history is preserved, so
      // the agent sees its own question followed by the user's reply and
      // continues naturally without losing context.
      console.log(`[job ${jobId}] aborting blocked session to unblock question tool`);
      await session.client.session.abort({
        path: { id: session.sessionId },
        query: { directory: session.directory },
      });

      // Brief pause so the abort settles before we enqueue the answer.
      await new Promise((r) => setTimeout(r, 500));

      console.log(`[job ${jobId}] sending user answer via promptAsync after abort`);
      await session.client.session.promptAsync({
        path: { id: session.sessionId },
        query: { directory: session.directory },
        body: { parts: [{ type: "text", text: message }] },
      });
    } else {
      // No pending question — send a regular follow-up message to the session.
      await session.client.session.promptAsync({
        path: { id: session.sessionId },
        query: { directory: session.directory },
        body: { parts: [{ type: "text", text: message }] },
      });
    }
  }

  if (keepWaiting) {
    // Keep WAITING_INPUT — the idle handler will check the session summary
    // and only complete the job when the agent has finished the task.
    eventBus.emit({ type: SSE_EVENT.JOB_WAITING, data: { jobId } });
  } else {
    // Resume the job as RUNNING — the event loop will re-park it if needed.
    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.RUNNING })
      .where(eq(schema.jobs.id, jobId));

    eventBus.emit({
      type: SSE_EVENT.JOB_STARTED,
      data: { jobId, status: JOB_STATUS.RUNNING },
    });
  }
}
