import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { eventBus } from "../lib/events.js";
import { acquireServer, getServerPid, touchServer } from "./opencode-pool.js";
import { getOpenCodeSession } from "./opencode-session.js";
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

// ─── Shared event loop ───────────────────────────────────────────────────────

interface EventLoopParams {
  jobId: string;
  client: ReturnType<typeof createOpencodeClient>;
  sessionId: string;
  cwd: string;
  playbookId: string | null | undefined;
  model: string | null;
  sub: AsyncIterable<unknown>;
  /** Set to true when we know the agent has already used the question tool
   *  (e.g. when reconnecting mid-conversation). Enables stricter completion
   *  gating so a follow-up plain-text response doesn't prematurely complete the job. */
  hasQuestions?: boolean;
}

/**
 * Drives the event loop for an OpenCode session until it completes, fails,
 * or is cancelled. Shared between fresh executions and reconnected sessions.
 */
async function runEventLoop({
  jobId,
  client,
  sessionId,
  cwd,
  playbookId,
  model,
  sub,
  hasQuestions: initialHasQuestions = false,
}: EventLoopParams): Promise<void> {
  let hasQuestions = initialHasQuestions;

  for await (const raw of sub) {
    const event = raw as { type: string; properties: Record<string, unknown> };
    if (!event?.type) continue;

    const props = event.properties as Record<string, unknown> & { sessionID?: string };
    if (props.sessionID && props.sessionID !== sessionId) continue; // skip other sessions

    // ── Agent asked a question (question tool) ─────────────────────────
    if (event.type === "question.asked") {
      hasQuestions = true;
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
      continue;
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

      if (currentJob?.status === JOB_STATUS.CANCELLED) break;

      const sessionData = await client.session.get({
        path: { id: sessionId },
        query: { directory: cwd },
      });
      type SessionSummary = { summary?: { title?: string; body?: string } };
      const rawSummary =
        (sessionData.data as SessionSummary)?.summary?.body ??
        (sessionData.data as SessionSummary)?.summary?.title ??
        null;

      // In conversational mode (agent used the `question` tool at least once),
      // only complete once the agent explicitly signals it is done via <<TASK_DONE>>.
      if (hasQuestions && !rawSummary) {
        const conversation = getOpenCodeSession(sessionId);
        const lastAssistantMsg = [...conversation].reverse().find((m) => m.role === "assistant");
        const taskDone = lastAssistantMsg?.parts.some(
          (p) => p.type === "text" && (p.text ?? "").includes("<<TASK_DONE>>"),
        ) ?? false;

        if (!taskDone) {
          if (currentJob?.status !== JOB_STATUS.WAITING_INPUT) {
            await db
              .update(schema.jobs)
              .set({ status: JOB_STATUS.WAITING_INPUT })
              .where(eq(schema.jobs.id, jobId));
            eventBus.emit({ type: SSE_EVENT.JOB_WAITING, data: { jobId } });
          }
          continue;
        }
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

      touchServer(playbookId!, model);
      break;
    }

    // ── Session error ──────────────────────────────────────────────────
    if (event.type === "session.error") {
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

    // 3. Persist PID + port so the job can be reconnected after a restart
    const pid = getServerPid(job.playbookId!, model);
    await db
      .update(schema.jobs)
      .set({ pid, serverPort: port })
      .where(eq(schema.jobs.id, jobId));

    // 4. Working directory
    const cwd = project.sourceType === "local"
      ? project.sourcePath
      : `data/workspaces/${project.id}`;

    // 5. Create OpenCode session for this project directory
    const sessionRes = await client.session.create({ query: { directory: cwd } });
    const sessionId = (sessionRes.data as { id: string }).id;

    // Persist session ID and register active session
    await db
      .update(schema.jobs)
      .set({ sessionId })
      .where(eq(schema.jobs.id, jobId));
    activeSessions.set(jobId, { client, sessionId, directory: cwd, baseUrl });

    // 6. Build prompt
    let fullPrompt = job.prompt;
    if (job.contextFrom) {
      fullPrompt = `## Context from previous step\n${job.contextFrom}\n\n## Your task\n${job.prompt}`;
    }
    fullPrompt += "\n\n---\nIMPORTANT: When you have fully completed all requested changes (written all files, made all edits, run all commands), you MUST end your final response with exactly: <<TASK_DONE>>";

    // 7. Subscribe BEFORE sending the prompt
    const sub = await client.event.subscribe({ query: { directory: cwd } });

    // 8. Send prompt
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

    await runEventLoop({ jobId, client, sessionId, cwd, playbookId: job.playbookId, model, sub: sub.stream });
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

// ─── Restart recovery ────────────────────────────────────────────────────────

/**
 * Re-attaches to an OpenCode server that is still running after an API restart.
 * Re-subscribes to the existing session's SSE stream and resumes the event loop.
 * Throws if the server is not reachable (caller should fall back to resumeJobWithHistory).
 */
export async function reconnectJob(job: typeof schema.jobs.$inferSelect): Promise<void> {
  const port = job.serverPort;
  if (!port) throw new Error(`Job ${job.id} has no saved server port`);

  const baseUrl = `http://127.0.0.1:${port}`;

  // Verify the server is still alive
  const alive = await fetch(`${baseUrl}/session`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!alive) throw new Error(`Server at port ${port} is not responding`);

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, job.projectId))
    .get();
  if (!project) throw new Error(`Project ${job.projectId} not found`);

  const cwd = project.sourceType === "local"
    ? project.sourcePath
    : `data/workspaces/${project.id}`;

  const client = createOpencodeClient({ baseUrl });
  const sessionId = job.sessionId!;
  const model = await resolveModel(job.modelOverride);

  activeSessions.set(job.id, { client, sessionId, directory: cwd, baseUrl });

  await db
    .update(schema.jobs)
    .set({ status: JOB_STATUS.RUNNING })
    .where(eq(schema.jobs.id, job.id));
  eventBus.emit({ type: SSE_EVENT.JOB_STARTED, data: { jobId: job.id, status: JOB_STATUS.RUNNING } });

  const sub = await client.event.subscribe({ query: { directory: cwd } });
  await logJobEvent(job.id, "session_reconnected", { sessionId, baseUrl, cwd, port });
  console.log(`[job ${job.id}] Reconnected to session ${sessionId} on ${baseUrl}`);

  try {
    await runEventLoop({
      jobId: job.id,
      client,
      sessionId,
      cwd,
      playbookId: job.playbookId,
      model,
      sub: sub.stream,
      hasQuestions: true, // conservative: prevents premature completion on first idle
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.FAILED, summary: message, completedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, job.id));
    eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId: job.id, error: message } });
    await logJobEvent(job.id, "error", { message });
  } finally {
    activeSessions.delete(job.id);
    pendingPermissions.delete(job.id);
    pendingQuestions.delete(job.id);
  }
}

/**
 * Resets a job to PENDING and injects the previous conversation as context,
 * so the next `executeJob` call resumes from where the interrupted session left off.
 *
 * Call this when the OpenCode server process is dead but the session history
 * is still readable from OpenCode's local SQLite database.
 */
export async function resumeJobWithHistory(job: typeof schema.jobs.$inferSelect): Promise<void> {
  const conversation = job.sessionId ? getOpenCodeSession(job.sessionId) : [];

  let history = "";
  if (conversation.length > 0) {
    history = "## Conversation history from previous session\n\n";
    for (const msg of conversation) {
      const role = msg.role === "assistant" ? "Assistant" : "User";
      const texts = msg.parts
        .filter((p) => p.type === "text" && p.text?.trim())
        .map((p) => p.text!)
        .join("\n");
      if (texts) history += `**${role}:**\n${texts}\n\n`;
    }
    history +=
      "---\n\nThe session was interrupted (server restart). Continue where you left off based on the conversation above.";
  }

  // Merge with any existing contextFrom (e.g. context from a parent job)
  const contextFrom = job.contextFrom
    ? `${job.contextFrom}\n\n---\n\n${history}`
    : history || null;

  await db
    .update(schema.jobs)
    .set({
      status: JOB_STATUS.PENDING,
      contextFrom,
      sessionId: null,
      pid: null,
      serverPort: null,
    })
    .where(eq(schema.jobs.id, job.id));

  console.log(
    `[orchestrator] Job ${job.id} reset to PENDING with ${conversation.length} history messages`,
  );
}

// ─── Human-in-the-loop ───────────────────────────────────────────────────────

/**
 * Responds to an active job that is waiting for user input.
 *
 * - `approve`: resolves a pending permission as "once" (allow this time).
 * - `deny`: resolves a pending permission as "reject".
 * - `message`: sends a follow-up prompt to the running session.
 * - `complete`: manually closes a job as completed (fallback for tasks with no summary).
 */
export async function respondToJob(
  jobId: string,
  action: "approve" | "deny" | "message" | "complete",
  message?: string,
): Promise<void> {
  const session = activeSessions.get(jobId);
  if (!session) throw new Error(`No active session for job ${jobId}`);

  if (action === "complete") {
    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.COMPLETED, completedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId));
    eventBus.emit({ type: SSE_EVENT.JOB_COMPLETED, data: { jobId, summary: "Completed by user" } });
    await logJobEvent(jobId, "completed", { summary: "Completed by user" });
    activeSessions.delete(jobId);
    pendingPermissions.delete(jobId);
    pendingQuestions.delete(jobId);
    return;
  }

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

    await logJobEvent(jobId, "user_response", {
      message: message.slice(0, 1000),
      ...(pq ? { questionId: pq.id } : {}),
    });

    if (pq) {
      pendingQuestions.delete(jobId);

      console.log(`[job ${jobId}] aborting blocked session to unblock question tool`);
      await session.client.session.abort({
        path: { id: session.sessionId },
        query: { directory: session.directory },
      });

      await new Promise((r) => setTimeout(r, 500));

      console.log(`[job ${jobId}] sending user answer via promptAsync after abort`);
      await session.client.session.promptAsync({
        path: { id: session.sessionId },
        query: { directory: session.directory },
        body: { parts: [{ type: "text", text: message }] },
      });
    } else {
      await session.client.session.promptAsync({
        path: { id: session.sessionId },
        query: { directory: session.directory },
        body: { parts: [{ type: "text", text: message }] },
      });
    }
  }

  await db
    .update(schema.jobs)
    .set({ status: JOB_STATUS.RUNNING })
    .where(eq(schema.jobs.id, jobId));

  eventBus.emit({
    type: SSE_EVENT.JOB_STARTED,
    data: { jobId, status: JOB_STATUS.RUNNING },
  });
}
