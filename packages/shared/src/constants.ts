/** Possible states for a job through its lifecycle */
export const JOB_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  WAITING_INPUT: "waiting_input",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

/** Source types for agents and skills */
export const RESOURCE_SOURCE = {
  LOCAL: "local",
  GIT: "git",
  MARKETPLACE: "marketplace",
} as const;

/** Project source types */
export const PROJECT_SOURCE = {
  LOCAL: "local",
  GIT: "git",
} as const;

/** MCP server connection types */
export const MCP_TYPE = {
  LOCAL: "local",
  REMOTE: "remote",
} as const;

/** Permission actions for playbook profiles */
export const PERMISSION_ACTION = {
  ALLOW: "allow",
  DENY: "deny",
  ASK: "ask",
} as const;

/** Permission profiles for playbooks */
export const PERMISSION_PROFILE = {
  AUTONOMOUS: "autonomous",
  ASSISTED: "assisted",
  RESTRICTIVE: "restrictive",
} as const;

/** SSE event types emitted by the API */
export const SSE_EVENT = {
  JOB_CREATED: "job.created",
  JOB_STARTED: "job.started",
  JOB_PROGRESS: "job.progress",
  JOB_WAITING: "job.waiting_input",
  JOB_COMPLETED: "job.completed",
  JOB_FAILED: "job.failed",
  JOB_CANCELLED: "job.cancelled",
  PERMISSION_ASKED: "permission.asked",
} as const;

/** Default API port */
export const DEFAULT_API_PORT = 4080;

/** Default timeout for waiting user input (ms) */
export const DEFAULT_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
