# AgentForge — Coding Agent Guide

AI agent orchestration dashboard. Users compose **Playbooks** (agent + skills + permissions), point them at a **Project** (local dir or Git repo), and launch **Jobs**. Jobs run inside OpenCode server processes managed by a pool. A Kanban board tracks job state with human-in-the-loop support.

---

## Key Commands

```bash
bun install              # Install all workspace dependencies
bun run dev              # Start api (4080) + web (3000) in parallel watch mode
bun run dev:api          # API only
bun run dev:web          # Web only
bun run build            # Production build
bun run test             # Run all tests (bun:test)
bun run lint             # ESLint across all packages
bun run typecheck        # tsc --noEmit

bun run db:generate      # Generate Drizzle migration after schema change
bun run db:migrate       # Apply pending migrations
bun run db:studio        # Drizzle Studio at http://localhost:4983
```

---

## Monorepo Layout

```
packages/
  api/      Hono REST API + SSE. Business logic. SQLite via Drizzle.
  web/      SolidJS frontend. Consumes the API.
  shared/   Zod schemas + TypeScript types used by both api and web.
data/       Runtime directory (gitignored)
  agentforge.db           SQLite database
  agents/*.md             File-backed agent definitions
  skills/{id}/SKILL.md    File-backed skill definitions
  playbooks/*.md          File-backed playbook definitions
  workspaces/{projectId}/ Git project clones
agentforge.config.json    App config (Ollama, pool TTL)
```

**Rule:** never import from `packages/api` in `packages/web` or vice versa. All shared types go through `packages/shared`.

---

## Storage Model — Two Separate Layers

| Entity | Storage | Why |
|--------|---------|-----|
| Agents, Skills, Playbooks | **Files** in `data/` with YAML frontmatter | Version-controllable, importable from ZIP/GitHub |
| Projects, Jobs, Runners, Models, MCPs | **SQLite** via Drizzle ORM | Relational queries, lifecycle state |

`markdown-sync.ts` handles all file I/O for the file-backed entities. IDs are slugified from filenames.

**File-backed entities have no Drizzle schema** — do not query them with `db.select().from(schema.agents)`. Use the `markdown-sync` exports instead.

---

## Database Schema

```
agents          id, name, description, markdown_content, tools(JSON), model, tags(JSON), source, version
skills          id, name, description, skill_md_content, has_scripts, has_templates, archive_path, tags(JSON), source, version
mcps            id, name, type(local|remote), config(JSON), enabled, health_status
playbooks       id, name, description, permission_profile, permissions(JSON), agent_ids(JSON), skill_ids(JSON), mcp_ids(JSON), agents_rules
projects        id, name, source_type(local|git), source_path, branch, env_vars(JSON), playbook_ids(JSON)
jobs            id, prompt, project_id→projects, playbook_id, agent_override, model_override,
                status, parent_job_id, context_from, session_id, pid, server_port,
                summary, cost(JSON), started_at, completed_at, created_at
job_events      id, job_id→jobs, event_type, payload(JSON), created_at
auto_rules      id, playbook_id, pattern, action(allow|deny), description
runners         id, type(opencode|claudecode), name, config(JSON {binaryPath,defaultModel,maxConcurrent}), enabled, status
models          id, provider, model_id, display_name, enabled
```

**Safety nets in `packages/api/src/index.ts`:** columns added outside Drizzle migrations (`pid`, `server_port`) are applied with bare `ALTER TABLE … ADD COLUMN` inside a try/catch on startup. Follow this same pattern when adding columns without a full migration.

**No FK on `jobs.playbook_id`** — playbooks are file-backed, not DB rows. The FK was intentionally dropped at startup via a table-recreation migration in `index.ts`.

---

## API Routes

All routes mounted at `/api/v1/`. Health check at `GET /api/health`.

| File | Routes |
|------|--------|
| `routes/agents.ts` | GET / · GET /:id · DELETE /:id · POST /import |
| `routes/skills.ts` | GET / · GET /:id · DELETE /:id · POST /import |
| `routes/playbooks.ts` | GET / · GET /:id · DELETE /:id · POST /import |
| `routes/projects.ts` | GET / · POST / · GET /:id · PUT /:id · DELETE /:id |
| `routes/jobs.ts` | GET /?project_id= · POST / · GET /:id (includes events + conversation) · POST /:id/respond · POST /:id/cancel |
| `routes/models.ts` | GET / · POST / · PATCH /:id · DELETE /:id · GET /opencode · GET /ollama · POST /ollama/pull (SSE) |
| `routes/runners.ts` | GET / · GET /:id · PATCH /:id · POST /:id/check |
| `routes/config.ts` | GET / · PUT / · GET /health · POST /ollama/apply-ctx |
| `routes/events.ts` | GET /?job_id= (SSE stream, heartbeat every 15 s) |

**Response shape:** always `{ data: T }` on success, `{ error: { code, message } }` on failure.

**Import routes** accept either `multipart/form-data` with a ZIP file, or JSON `{ url }` with a GitHub blob/tree URL.

---

## Services

### `orchestrator.ts` — Job execution core

- **`executeJob(jobId)`** — Full job lifecycle: acquires server → creates OpenCode session → sends prompt → drives SSE event loop. Saves `pid` and `serverPort` to the job row immediately after `acquireServer`.
- **`respondToJob(jobId, action, message?)`** — Human-in-the-loop handler. Actions: `approve`, `deny`, `message`, `complete`.
  - `message` with a pending question: aborts the blocked session, waits 500 ms, re-sends answer via `promptAsync` (abort+reprompt pattern to unblock OpenCode's `question` tool).
  - `complete`: marks job COMPLETED directly, clears in-memory state.
- **`reconnectJob(job)`** — After API restart, re-attaches to an OpenCode server still alive at `job.serverPort`. Re-subscribes to SSE, resumes event loop with `hasQuestions=true`.
- **`resumeJobWithHistory(job)`** — After API restart when server is dead. Reads conversation from OpenCode's SQLite, formats it as `contextFrom`, resets job to PENDING for the dispatcher to pick up.
- **`runEventLoop(params)`** — Shared internal async loop (used by both `executeJob` and `reconnectJob`). Handles `question.asked`, `permission.updated`, `session.idle`, `session.error`.

**Completion detection logic:**
```
session.idle fires
  └─ if hasQuestions && no OpenCode summary:
       read last assistant message from OpenCode SQLite
       if "<<TASK_DONE>>" present → complete
       else → re-park as WAITING_INPUT
  └─ otherwise → complete (use OpenCode summary or "Session completed")
```

Every prompt gets this appended automatically:
> `IMPORTANT: When you have fully completed all requested changes… end your final response with exactly: <<TASK_DONE>>`

**In-memory state** (lost on restart, recovered by dispatcher on next startup):
- `activeSessions: Map<jobId, { client, sessionId, directory, baseUrl }>`
- `pendingPermissions: Map<jobId, Permission>`
- `pendingQuestions: Map<jobId, { id, questions[] }>`

### `opencode-pool.ts` — Server pool

Manages a pool of `opencode serve` processes keyed by `{playbookId}:{model ?? ""}`.

- **`acquireServer(playbookId, model?)`** → port. Spawns a new server if none or dead. Deduplicates concurrent spawns for the same key.
- **`getServerPid(playbookId, model?)`** → pid | null. Call after `acquireServer` to persist to job row.
- **`touchServer(playbookId, model?)`** — Resets idle TTL clock after a job completes.
- **`startIdleReaper()`** — Kills servers idle longer than `pool.serverIdleTtlMinutes` (default 15). Runs every 60 s, unref'd.
- **`shutdownPool()`** — Kills all servers synchronously. Registered on `process.on('exit')`.
- Each spawned server receives `OPENCODE_CONFIG_DIR` pointing at the materialized playbook directory.

### `materializer.ts` — Playbook → OpenCode config dir

```
materializePlaybook(playbookId, jobId, modelOverride?)
  → os.tmpdir()/agentforge-{jobId}/
      agents/{agent.name}.md
      skills/{skillId}/SKILL.md
      opencode.json  (permissions + optional Ollama provider + MCP servers)
      AGENTS.md      (playbook.agentsRules)
```

Ollama models (`ollama/*`): injects a provider block into `opencode.json` pointing at configured Ollama `baseUrl`.

### `job-dispatcher.ts` — Background polling

- Polls every 3 s. Fills slots up to runner's `maxConcurrent` (re-read on every tick so changes take effect live).
- **`startDispatcher()`** — Runs `recoverStaleJobs()` first, then starts polling.
- **`recoverStaleJobs()`** — On startup:
  - `RUNNING` + `serverPort` responds to HTTP → `reconnectJob()` in background
  - `RUNNING`/`WAITING_INPUT` + dead server + has `sessionId` → `resumeJobWithHistory()` (resets to PENDING)
  - Otherwise → mark FAILED
- **`releaseJobSlot(jobId)`** — Call when cancelling externally (HTTP cancel route) so the slot is freed immediately.

### `opencode-session.ts`

**`getOpenCodeSession(sessionId)`** — Reads `~/.local/share/opencode/opencode.db` (OpenCode's own SQLite) and returns the full conversation as `ConversationMessage[]`. Used for `<<TASK_DONE>>` detection and history replay on resume.

### `markdown-sync.ts`

File-backed CRUD for agents, skills, playbooks. Files live in `data/{agents,skills,playbooks}/`. Frontmatter parsed with gray-matter (or equivalent). IDs are derived from slugified filenames.

### `importer.ts`

`importFromZip(buffer, type)` / `importFromGitHubUrl(url, type)` — Extracts Markdown files from a ZIP archive or GitHub URL and calls `markdown-sync` to persist them.

---

## Shared Package (`packages/shared`)

Single source of truth for all types. **Always define Zod schemas here first**, then derive TypeScript types with `z.infer<>`.

**Key constants (`constants.ts`):**

```typescript
JOB_STATUS         pending | running | waiting_input | completed | failed | cancelled
SSE_EVENT          job.created | job.started | job.waiting_input | job.completed
                   job.failed | job.cancelled | permission.asked
PERMISSION_PROFILE autonomous | assisted | restrictive
DEFAULT_API_PORT   4080
```

**Key schemas (`schemas/index.ts`):** `agentSchema`, `skillSchema`, `playbookSchema`, `projectSchema`, `jobSchema`, `createJobSchema`, `respondJobSchema`, `permissionConfigSchema`, `instanceConfigSchema`, `modelSchema`.

---

## SSE Events

Endpoint: `GET /api/v1/events?job_id=X` (filter optional).

```
event: job.started
data: {"jobId":"…","startedAt":"…"}
```

Heartbeat `:` comment every 15 s. `eventBus` in `lib/events.ts` is the in-process pub/sub singleton — call `eventBus.emit()` from services, never directly from routes.

---

## Frontend (`packages/web`)

Stack: SolidJS + Solid Router + TailwindCSS v4. No CSS build step.

**Pages:**

| File | Route | Purpose |
|------|-------|---------|
| `Dashboard.tsx` | `/` | Health status + nav links |
| `Agents.tsx` | `/agents` | List, import ZIP/GitHub, delete |
| `Skills.tsx` | `/skills` | List, import, delete |
| `Playbooks.tsx` | `/playbooks` | List with permission profile badges, import, expand for linked agents/skills |
| `Models.tsx` | `/models` | OpenCode + Ollama model management, pull with SSE progress |
| `Ollama.tsx` | `/ollama` | Ollama instance config (baseUrl, numCtx) |
| `Runners.tsx` | `/runners` | Runner config + health checks |
| `ProjectBoard.tsx` | `/projects/:id` | Kanban board: Pending / Active / Blocked / Done. Job detail with conversation history and respond panel. |

**Stores:** `stores/project.ts` — `activeProjectId` signal, persisted to `localStorage` under key `agentforge:activeProjectId`.

**Components:** `Layout.tsx` — Root layout with sidebar nav and project selector dialog.

**SolidJS patterns used:**
- `createResource` for async data fetching
- `createEffect` for side effects (e.g. auto-scroll conversation panel)
- `createSignal` for local UI state
- `Show` / `For` for conditional rendering / lists

---

## Configuration

`agentforge.config.json` — read/written by `packages/api/src/config.ts` (`readConfig()` / `writeConfig(patch)`).

```json
{
  "ollama": { "enabled": false, "baseUrl": "http://localhost:11434", "numCtx": 4096 },
  "pool":   { "serverIdleTtlMinutes": 15 }
}
```

---

## Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `PORT` | `4080` | API server |
| `AGENTFORGE_API_URL` | `http://localhost:4080` | CLI |
| `OPENCODE_CONFIG_DIR` | (set per-server) | Each spawned `opencode serve` process |

---

## Error Handling

Services throw typed errors from `lib/errors.ts`:

```typescript
throw new NotFoundError("Job", id);          // 404
throw new ConflictError("already exists");   // 409
throw new ApiError("MY_CODE", "msg", 400);   // custom status
```

Global `app.onError` in `index.ts` catches all `ApiError` subclasses and formats them as `{ error: { code, message } }`.

---

## Code Standards

- TypeScript strict mode everywhere. No `any` — use `unknown` + narrowing.
- `const` over `let`. Never `var`.
- JSDoc on all exported functions.
- File naming: kebab-case · PascalCase for components · camelCase for functions/variables.
- No default exports from non-component files.
- Schema changes → `packages/shared/` first, then api + web.

---

## Common Gotchas

- **`hasQuestions` flag**: once an agent uses the `question` tool in a session, `session.idle` alone will never complete the job — it must see `<<TASK_DONE>>` in the final assistant text. If you're debugging a job stuck in RUNNING, check whether the last assistant message contains this marker.
- **Abort+reprompt**: OpenCode's `question` tool in headless server mode blocks the session; you cannot inject a new message while it is blocked. `respondToJob("message")` first aborts, waits 500 ms, then re-sends via `promptAsync`. Conversation history is preserved.
- **Pool key includes model**: `{playbookId}:{model}`. Changing the model spawns a second server for the same playbook.
- **`activeSessions` is in-memory**: after an API restart it is empty. The dispatcher calls `reconnectJob` or `resumeJobWithHistory` to recover — do not rely on `activeSessions` being populated at startup.
- **`jobs.playbook_id` has no FK**: playbooks are file-backed. Referential integrity is not enforced by the DB.
- **Safety net columns**: `pid` and `server_port` on `jobs` are not in any Drizzle migration — they are added via bare `ALTER TABLE` in `index.ts`. If you add more columns this way, follow the same pattern in the startup block.
