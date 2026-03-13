import { z } from "zod";
import {
  JOB_STATUS,
  RESOURCE_SOURCE,
  PROJECT_SOURCE,
  MCP_TYPE,
  PERMISSION_PROFILE,
  PERMISSION_ACTION,
} from "../constants.js";

// ─── Agent ───────────────────────────────────────────────────────────

export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  markdownContent: z.string().min(1),
  tools: z.array(z.string()).default([]),
  model: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  source: z.enum([RESOURCE_SOURCE.LOCAL, RESOURCE_SOURCE.GIT, RESOURCE_SOURCE.MARKETPLACE]),
  version: z.string().default("1.0.0"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createAgentSchema = agentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAgentSchema = createAgentSchema.partial();

// ─── Skill ───────────────────────────────────────────────────────────

export const skillSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  skillMdContent: z.string().min(1),
  hasScripts: z.boolean().default(false),
  hasTemplates: z.boolean().default(false),
  archivePath: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  source: z.enum([RESOURCE_SOURCE.LOCAL, RESOURCE_SOURCE.GIT, RESOURCE_SOURCE.MARKETPLACE]),
  version: z.string().default("1.0.0"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createSkillSchema = skillSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSkillSchema = createSkillSchema.partial();

// ─── MCP Server ──────────────────────────────────────────────────────

export const mcpLocalConfigSchema = z.object({
  command: z.array(z.string()),
  environment: z.record(z.string()).optional(),
});

export const mcpRemoteConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const mcpSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum([MCP_TYPE.LOCAL, MCP_TYPE.REMOTE]),
  config: z.union([mcpLocalConfigSchema, mcpRemoteConfigSchema]),
  enabled: z.boolean().default(true),
  healthStatus: z.enum(["healthy", "unhealthy", "unknown"]).default("unknown"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createMcpSchema = mcpSchema.omit({
  id: true,
  healthStatus: true,
  createdAt: true,
  updatedAt: true,
});

// ─── Playbook ────────────────────────────────────────────────────────

export const permissionConfigSchema = z.object({
  bash: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY, PERMISSION_ACTION.ASK]),
  edit: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY, PERMISSION_ACTION.ASK]),
  write: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY, PERMISSION_ACTION.ASK]),
  webfetch: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY, PERMISSION_ACTION.ASK]),
  externalDirectory: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY, PERMISSION_ACTION.ASK]),
});

export const playbookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().default(""),
  permissionProfile: z.enum([
    PERMISSION_PROFILE.AUTONOMOUS,
    PERMISSION_PROFILE.ASSISTED,
    PERMISSION_PROFILE.RESTRICTIVE,
  ]),
  permissions: permissionConfigSchema,
  agentIds: z.array(z.string().uuid()).default([]),
  skillIds: z.array(z.string().uuid()).default([]),
  mcpIds: z.array(z.string().uuid()).default([]),
  agentsRules: z.string().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createPlaybookSchema = playbookSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ─── Project ─────────────────────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  sourceType: z.enum([PROJECT_SOURCE.LOCAL, PROJECT_SOURCE.GIT]),
  sourcePath: z.string().min(1),
  branch: z.string().nullable().default(null),
  envVars: z.record(z.string()).default({}),
  playbookIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createProjectSchema = projectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateProjectSchema = createProjectSchema.partial();

// ─── Job ─────────────────────────────────────────────────────────────

export const jobStatusSchema = z.enum([
  JOB_STATUS.PENDING,
  JOB_STATUS.RUNNING,
  JOB_STATUS.WAITING_INPUT,
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED,
]);

export const costSchema = z.object({
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  estimatedCostUsd: z.number().default(0),
});

export const jobSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().min(1),
  projectId: z.string().uuid(),
  playbookId: z.string().min(1),
  agentOverride: z.string().nullable().default(null),
  modelOverride: z.string().nullable().default(null),
  status: jobStatusSchema,
  parentJobId: z.string().uuid().nullable().default(null),
  contextFrom: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  cost: costSchema.nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
});

export const createJobSchema = z.object({
  prompt: z.string().min(1),
  projectId: z.string().uuid(),
  playbookId: z.string().min(1),
  agentOverride: z.string().nullable().optional(),
  modelOverride: z.string().nullable().optional(),
  parentJobId: z.string().uuid().nullable().optional(),
  contextFrom: z.string().nullable().optional(),
});

export const respondJobSchema = z.object({
  action: z.enum(["approve", "deny", "message", "complete"]),
  message: z.string().optional(),
});

// ─── Job Event ───────────────────────────────────────────────────────

export const jobEventSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

// ─── Auto Rule ───────────────────────────────────────────────────────

export const autoRuleSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string().min(1),
  pattern: z.string().min(1),
  action: z.enum([PERMISSION_ACTION.ALLOW, PERMISSION_ACTION.DENY]),
  description: z.string().default(""),
  createdAt: z.string().datetime(),
});

// ─── Instance Config ─────────────────────────────────────────────────

export const ollamaConfigSchema = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().url().default("http://localhost:11434"),
  numCtx: z.number().int().min(512).default(8192),
});

export const poolConfigSchema = z.object({
  serverIdleTtlMinutes: z.number().int().min(1).default(15),
});

export const instanceConfigSchema = z.object({
  ollama: ollamaConfigSchema.default({}),
  pool: poolConfigSchema.default({}),
});

export const updateInstanceConfigSchema = instanceConfigSchema.deepPartial();

// ─── Model ───────────────────────────────────────────────────────────

export const modelProviderSchema = z.string().min(1);

export const modelSchema = z.object({
  id: z.string().uuid(),
  provider: modelProviderSchema,
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createModelSchema = modelSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** Model as returned by Ollama's /api/tags */
export const ollamaModelSchema = z.object({
  name: z.string(),
  model: z.string(),
  modified_at: z.string(),
  size: z.number(),
  digest: z.string(),
  details: z.object({
    parameter_size: z.string().optional(),
    quantization_level: z.string().optional(),
    family: z.string().optional(),
  }).optional(),
});

export const ollamaPullStatusSchema = z.object({
  status: z.string(),
  digest: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
});

// ─── API Response wrappers ───────────────────────────────────────────

export const apiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ data: dataSchema });

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const paginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
