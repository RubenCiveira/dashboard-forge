import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { eventBus } from "../lib/events.js";
import { materializePlaybook } from "./materializer.js";
import { extractSessionId } from "./opencode-session.js";
import { JOB_STATUS, SSE_EVENT } from "@agentforge/shared";

/**
 * Resolves the model to use for a job.
 * Priority: job.modelOverride → runner.defaultModel → null (use OpenCode default).
 * Returns null to let OpenCode use whatever model is configured in its own config.
 */
async function resolveModel(
  jobModelOverride: string | null | undefined,
): Promise<string | null> {
  if (jobModelOverride) return jobModelOverride;

  // Fallback: first enabled runner's defaultModel
  const runner = await db.select().from(schema.runners).limit(1).get();
  if (runner) {
    const cfg = JSON.parse(runner.config) as { defaultModel?: string };
    if (cfg.defaultModel) return cfg.defaultModel;
  }

  // No model configured anywhere — let OpenCode use its own default
  return null;
}

/**
 * Checks if an Ollama model is available locally and pulls it if not.
 * Emits job events with pull progress.
 */
async function ensureOllamaModel(modelName: string, jobId: string): Promise<void> {
  const baseURL = (globalThis as Record<string, unknown> & { Bun?: { env?: Record<string, string> } })
    .Bun?.env?.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const ollamaRoot = baseURL.replace(/\/v1$/, "");

  // Check if model exists
  const showRes = await fetch(`${ollamaRoot}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });

  if (showRes.ok) return; // Model already present

  // Pull the model — Ollama streams NDJSON progress lines
  console.log(`[job ${jobId}] Ollama model "${modelName}" not found locally, pulling…`);
  await logJobEvent(jobId, "ollama_pull_start", { model: modelName });

  const pullRes = await fetch(`${ollamaRoot}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: modelName, stream: true }),
  });

  if (!pullRes.ok || !pullRes.body) {
    throw new Error(`Failed to pull Ollama model "${modelName}": HTTP ${pullRes.status}`);
  }

  const reader = pullRes.body.getReader();
  const decoder = new TextDecoder();
  let lastStatus = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(line) as { status?: string; error?: string };
        if (event.error) throw new Error(`Ollama pull error: ${event.error}`);
        if (event.status && event.status !== lastStatus) {
          lastStatus = event.status;
          console.log(`[job ${jobId}] ollama pull: ${event.status}`);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // incomplete JSON line
        throw e;
      }
    }
  }

  await logJobEvent(jobId, "ollama_pull_done", { model: modelName });
  console.log(`[job ${jobId}] Ollama model "${modelName}" ready.`);
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
    // 1. Resolve model first so the materializer can inject provider config
    const model = await resolveModel(job.modelOverride);

    // 1b. If using Ollama, ensure the model is available locally (pull if needed)
    if (model?.startsWith("ollama/")) {
      await ensureOllamaModel(model.slice("ollama/".length), jobId);
    }

    // 2. Materialize playbook as OPENCODE_CONFIG_DIR (passes resolved model)
    const configDir = await materializePlaybook(
      job.playbookId!,
      jobId,
      model,
    );

    // 3. Build prompt (with parent context if chained)
    let fullPrompt = job.prompt;
    if (job.contextFrom) {
      fullPrompt = `## Context from previous step\n${job.contextFrom}\n\n## Your task\n${job.prompt}`;
    }

    // 4. Build opencode CLI args — omit --model when null (use OpenCode's own default)
    const args = ["run", fullPrompt, "--format", "json"];
    if (model) args.push("--model", model);
    if (job.agentOverride) args.push("--agent", job.agentOverride);

    // 5. Working directory
    const cwd = project.sourceType === "local"
      ? project.sourcePath
      : `data/workspaces/${project.id}`;

    // 6. Launch opencode
    console.log(`[job ${jobId}] cwd: ${cwd}`);
    console.log(`[job ${jobId}] cmd: opencode ${args.map((a) => a.includes(" ") ? `"${a}"` : a).join(" ")}`);
    console.log(`[job ${jobId}] OPENCODE_CONFIG_DIR: ${configDir}`);
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

    // Read stdout and stderr concurrently to avoid pipe-buffer deadlocks
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Ensure the process is dead (handles cases where pipes closed but process lingers)
    try { proc.kill(); } catch { /* already dead */ }

    if (exitCode !== 0) {
      await db
        .update(schema.jobs)
        .set({ status: JOB_STATUS.FAILED, summary: [stderr, stdout].filter(Boolean).join("\n---\n") || `exit code ${exitCode}`, sessionId: extractSessionId(stdout) ?? undefined, completedAt: new Date().toISOString() })
        .where(eq(schema.jobs.id, jobId));

      eventBus.emit({ type: SSE_EVENT.JOB_FAILED, data: { jobId, error: stderr } });
      await logJobEvent(jobId, "failed", { exitCode, stderr });
      return;
    }

    // 7. Extract sessionId and summary
    const sessionId = extractSessionId(stdout);
    const summary = stdout;

    // 8. Complete
    await db
      .update(schema.jobs)
      .set({ status: JOB_STATUS.COMPLETED, summary, sessionId: sessionId ?? undefined, completedAt: new Date().toISOString() })
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
