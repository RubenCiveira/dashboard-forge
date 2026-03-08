import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentsRouter } from "./routes/agents.js";
import { eventsRouter } from "./routes/events.js";
import { configRouter } from "./routes/config.js";
import { modelsRouter } from "./routes/models.js";
import { projectsRouter } from "./routes/projects.js";
import { jobsRouter } from "./routes/jobs.js";
import { ApiError } from "./lib/errors.js";
import { DEFAULT_API_PORT } from "@agentforge/shared";

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

// TODO: Mount remaining routes as they are implemented
// app.route("/api/v1/skills", skillsRouter);
// app.route("/api/v1/mcps", mcpsRouter);
// app.route("/api/v1/playbooks", playbooksRouter);

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

console.log(`🚀 AgentForge API running on http://localhost:${port}`);
console.log(`   Health: http://localhost:${port}/api/health`);
console.log(`   Agents: http://localhost:${port}/api/v1/agents`);
console.log(`   Events: http://localhost:${port}/api/v1/events`);

export default {
  port,
  fetch: app.fetch,
};
