import type { z } from "zod";
import type {
  agentSchema,
  createAgentSchema,
  updateAgentSchema,
  skillSchema,
  createSkillSchema,
  mcpSchema,
  createMcpSchema,
  playbookSchema,
  createPlaybookSchema,
  projectSchema,
  createProjectSchema,
  updateProjectSchema,
  jobSchema,
  createJobSchema,
  respondJobSchema,
  jobEventSchema,
  autoRuleSchema,
  permissionConfigSchema,
  costSchema,
  jobStatusSchema,
  instanceConfigSchema,
  updateInstanceConfigSchema,
  modelSchema,
  createModelSchema,
  ollamaModelSchema,
  ollamaPullStatusSchema,
} from "../schemas/index.js";

// ─── Entity types ────────────────────────────────────────────────────

export type Agent = z.infer<typeof agentSchema>;
export type CreateAgent = z.infer<typeof createAgentSchema>;
export type UpdateAgent = z.infer<typeof updateAgentSchema>;

export type Skill = z.infer<typeof skillSchema>;
export type CreateSkill = z.infer<typeof createSkillSchema>;

export type Mcp = z.infer<typeof mcpSchema>;
export type CreateMcp = z.infer<typeof createMcpSchema>;

export type Playbook = z.infer<typeof playbookSchema>;
export type CreatePlaybook = z.infer<typeof createPlaybookSchema>;
export type PermissionConfig = z.infer<typeof permissionConfigSchema>;

export type Project = z.infer<typeof projectSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;

export type Job = z.infer<typeof jobSchema>;
export type CreateJob = z.infer<typeof createJobSchema>;
export type RespondJob = z.infer<typeof respondJobSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type Cost = z.infer<typeof costSchema>;

export type JobEvent = z.infer<typeof jobEventSchema>;
export type AutoRule = z.infer<typeof autoRuleSchema>;

export type InstanceConfig = z.infer<typeof instanceConfigSchema>;
export type UpdateInstanceConfig = z.infer<typeof updateInstanceConfigSchema>;

export type Model = z.infer<typeof modelSchema>;
export type CreateModel = z.infer<typeof createModelSchema>;
export type OllamaModel = z.infer<typeof ollamaModelSchema>;
export type OllamaPullStatus = z.infer<typeof ollamaPullStatusSchema>;

// ─── API response types ──────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── SSE event payload types ─────────────────────────────────────────

export interface SseEvent<T = unknown> {
  type: string;
  data: T;
}

export interface PermissionRequest {
  jobId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}
