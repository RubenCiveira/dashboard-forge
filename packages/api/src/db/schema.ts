import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Agents ──────────────────────────────────────────────────────────

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  markdownContent: text("markdown_content").notNull(),
  tools: text("tools").notNull().default("[]"),
  model: text("model"),
  tags: text("tags").notNull().default("[]"),
  source: text("source").notNull().default("local"),
  version: text("version").notNull().default("1.0.0"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Skills ──────────────────────────────────────────────────────────

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  skillMdContent: text("skill_md_content").notNull(),
  hasScripts: integer("has_scripts", { mode: "boolean" }).notNull().default(false),
  hasTemplates: integer("has_templates", { mode: "boolean" }).notNull().default(false),
  archivePath: text("archive_path"),
  tags: text("tags").notNull().default("[]"),
  source: text("source").notNull().default("local"),
  version: text("version").notNull().default("1.0.0"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── MCP Servers ─────────────────────────────────────────────────────

export const mcps = sqliteTable("mcps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  healthStatus: text("health_status").notNull().default("unknown"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Playbooks ───────────────────────────────────────────────────────

export const playbooks = sqliteTable("playbooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  permissionProfile: text("permission_profile").notNull().default("autonomous"),
  permissions: text("permissions").notNull(),
  agentIds: text("agent_ids").notNull().default("[]"),
  skillIds: text("skill_ids").notNull().default("[]"),
  mcpIds: text("mcp_ids").notNull().default("[]"),
  agentsRules: text("agents_rules").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Projects ────────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  sourcePath: text("source_path").notNull(),
  branch: text("branch"),
  defaultModel: text("default_model").notNull().default("ollama/qwen3:8b-16k"),
  envVars: text("env_vars").notNull().default("{}"),
  playbookIds: text("playbook_ids").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Jobs ────────────────────────────────────────────────────────────

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  playbookId: text("playbook_id"),
  agentId: text("agent_id"),
  agentOverride: text("agent_override"),
  modelOverride: text("model_override"),
  status: text("status").notNull().default("pending"),
  parentJobId: text("parent_job_id"),
  contextFrom: text("context_from"),
  sessionId: text("session_id"),
  pid: integer("pid"),
  summary: text("summary"),
  cost: text("cost"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

// ─── Job Events ──────────────────────────────────────────────────────

export const jobEvents = sqliteTable("job_events", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

// ─── Auto Rules ──────────────────────────────────────────────────────

export const autoRules = sqliteTable("auto_rules", {
  id: text("id").primaryKey(),
  playbookId: text("playbook_id").notNull(),
  pattern: text("pattern").notNull(),
  action: text("action").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ─── Runners ─────────────────────────────────────────────────────────

export const runners = sqliteTable("runners", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // 'opencode' | 'claudecode'
  name: text("name").notNull(),
  config: text("config").notNull().default("{}"), // JSON: type-specific config
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull().default("unknown"), // 'online' | 'offline' | 'unknown'
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Models ──────────────────────────────────────────────────────────

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
