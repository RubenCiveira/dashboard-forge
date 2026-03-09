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
console.log("✓ Migrations applied");

// Seed default OpenCode runner if none exists
const existingRunners = await db.select().from(runners).all();
if (existingRunners.length === 0) {
  const now = new Date().toISOString();
  await db.insert(runners).values({
    id: randomUUID(),
    type: "opencode",
    name: "OpenCode",
    config: JSON.stringify({ binaryPath: "opencode", defaultModel: "" }),
    enabled: true,
    status: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  console.log("✓ Default OpenCode runner seeded");
}

console.log(`🚀 AgentForge API running on http://localhost:${port}`);
console.log(`   Health: http://localhost:${port}/api/health`);
console.log(`   Agents: http://localhost:${port}/api/v1/agents`);
console.log(`   Events: http://localhost:${port}/api/v1/events`);

export default {
  port,
  fetch: app.fetch,
};
