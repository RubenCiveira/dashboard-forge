import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentsRouter } from "./routes/agents.js";
import { eventsRouter } from "./routes/events.js";
import { configRouter } from "./routes/config.js";
import { modelsRouter } from "./routes/models.js";
import { projectsRouter } from "./routes/projects.js";
import { jobsRouter } from "./routes/jobs.js";
import { skillsRouter } from "./routes/skills.js";
import { playbooksRouter } from "./routes/playbooks.js";
import { runnersRouter } from "./routes/runners.js";
import { ApiError } from "./lib/errors.js";
import { startDispatcher } from "./services/job-dispatcher.js";
import { startIdleReaper, shutdownPool } from "./services/opencode-pool.js";
import { DEFAULT_API_PORT } from "@agentforge/shared";
import { db, sqlite } from "./db/index.js";
import { runners } from "./db/schema.js";
import { randomUUID } from "crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { resolve } from "path";

const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────

app.use("*", cors({ origin: "*" }));
app.use("*", logger());

// ─── Routes ──────────────────────────────────────────────────────────

app.route("/api/v1/agents", agentsRouter);
app.route("/api/v1/events", eventsRouter);
app.route("/api/v1/config", configRouter);
app.route("/api/v1/models", modelsRouter);
app.route("/api/v1/projects", projectsRouter);
app.route("/api/v1/jobs", jobsRouter);
app.route("/api/v1/skills", skillsRouter);
app.route("/api/v1/playbooks", playbooksRouter);
app.route("/api/v1/runners", runnersRouter);

// ─── Health check ────────────────────────────────────────────────────

app.get("/api/health", (ctx) =>
  ctx.json({ status: "ok", version: "0.1.0" }),
);

// ─── Error handling ──────────────────────────────────────────────────

app.onError((err, ctx) => {
  if (err instanceof ApiError) {
    return ctx.json(
      { error: { code: err.code, message: err.message } },
      err.status as 400,
    );
  }

  console.error("Unhandled error:", err);
  return ctx.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    500,
  );
});

// ─── Start server ────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? DEFAULT_API_PORT);

// Apply pending DB migrations
migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });

// Ensure tables added in later migrations exist (safety net for bun-sqlite migrator quirks)
sqlite.run(`
  CREATE TABLE IF NOT EXISTS runners (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// Drop FK on jobs.playbook_id — playbooks are now file-backed, not DB rows.
// SQLite requires recreating the table to drop a constraint.
try {
  const hasFK = sqlite.query<{ sql: string }, []>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'"
  ).get();
  if (hasFK?.sql?.includes("REFERENCES `playbooks`")) {
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(`CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY NOT NULL, prompt TEXT NOT NULL, project_id TEXT NOT NULL,
      playbook_id TEXT, agent_id TEXT, agent_override TEXT, model_override TEXT,
      status TEXT DEFAULT 'pending' NOT NULL, parent_job_id TEXT, context_from TEXT,
      session_id TEXT, summary TEXT, cost TEXT, started_at TEXT, completed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )`);
    sqlite.run("INSERT INTO jobs_new SELECT id,prompt,project_id,playbook_id,agent_id,agent_override,model_override,status,parent_job_id,context_from,session_id,summary,cost,started_at,completed_at,created_at FROM jobs");
    sqlite.run("DROP TABLE jobs");
    sqlite.run("ALTER TABLE jobs_new RENAME TO jobs");
    sqlite.run("PRAGMA foreign_keys = ON");
    console.log("✓ Dropped FK on jobs.playbook_id");
  }
} catch (e) {
  console.warn("⚠️  Could not drop jobs.playbook_id FK:", e);
}
// Safety net: ensure pid column exists (added in 0004)
try {
  sqlite.run("ALTER TABLE jobs ADD COLUMN pid INTEGER");
} catch { /* already exists */ }
console.log("✓ Migrations applied");

// Seed default OpenCode runner if none exists
const existingRunners = await db.select().from(runners).all();
if (existingRunners.length === 0) {
  const now = new Date().toISOString();
  await db.insert(runners).values({
    id: randomUUID(),
    type: "opencode",
    name: "OpenCode",
    config: JSON.stringify({ binaryPath: "opencode", defaultModel: "", maxConcurrent: 1 }),
    enabled: true,
    status: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  console.log("✓ Default OpenCode runner seeded");
}

// Start background job dispatcher (recovers stale jobs, then polls)
await startDispatcher();

// Start OpenCode server pool idle reaper
startIdleReaper();

// Graceful shutdown: kill all managed OpenCode server processes
const onShutdown = () => {
  shutdownPool();
};
process.on("SIGTERM", onShutdown);
process.on("SIGINT", onShutdown);
process.on("exit", onShutdown);

console.log(`🚀 AgentForge API running on http://localhost:${port}`);
console.log(`   Health: http://localhost:${port}/api/health`);
console.log(`   Agents: http://localhost:${port}/api/v1/agents`);
console.log(`   Events: http://localhost:${port}/api/v1/events`);

export default {
  port,
  fetch: app.fetch,
};
