# AgentForge

Dashboard de orquestación de agentes IA sobre OpenCode. Gestiona agentes, skills, MCPs y playbooks. Lanza tareas sobre proyectos locales o git. Chat multi-contexto para human-in-the-loop.

## Architecture

Monorepo TypeScript con Bun. Tres paquetes en `packages/`:

- **api** — Backend Hono sobre Bun. REST API + SSE. SQLite via Drizzle ORM.
- **web** — Frontend SolidJS + TailwindCSS. Consume la API.
- **cli** — CLI companion. Se compila a binario con `bun build --compile`.

Shared types live in `packages/shared/` — imported by all three packages.

## Key Commands

```bash
bun install              # Install all dependencies (workspace)
bun run dev              # Start api + web in parallel (dev mode)
bun run dev:api          # Start API only (port 4080)
bun run dev:web          # Start web only (port 3000)
bun run build            # Build all packages
bun run db:generate      # Generate Drizzle migrations
bun run db:migrate       # Run pending migrations
bun run db:studio        # Open Drizzle Studio (DB browser)
bun run test             # Run all tests
bun run lint             # ESLint across all packages
bun run typecheck        # TypeScript check across all packages
```

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun 1.3+ | Package manager, runtime, bundler, test runner |
| API framework | Hono v4 | Lightweight, type-safe, SSE support |
| Database | SQLite via better-sqlite3 | Zero config. File at `data/agentforge.db` |
| ORM | Drizzle ORM | Type-safe, SQL-first, great migrations |
| Frontend | SolidJS + Solid Router | Reactive, no vDOM, consistent with OpenCode UI |
| Styling | TailwindCSS v4 | Utility-first, no build step in v4 |
| OpenCode integration | @opencode-ai/sdk | Type-safe client for OpenCode server API |
| Validation | Zod | Shared schemas between API and frontend |

## Project Structure

```
agentforge/
├── CLAUDE.md                 # This file
├── package.json              # Workspace root
├── bunfig.toml               # Bun configuration
├── tsconfig.json             # Base TypeScript config
├── data/                     # SQLite database (gitignored)
├── packages/
│   ├── shared/               # Shared types, schemas, constants
│   │   ├── src/
│   │   │   ├── schemas/      # Zod schemas (agent, skill, project, job, etc.)
│   │   │   ├── types/        # Inferred TypeScript types from schemas
│   │   │   └── constants.ts  # Shared enums and constants
│   │   └── package.json
│   ├── api/                  # Backend
│   │   ├── src/
│   │   │   ├── index.ts      # Hono app entry point
│   │   │   ├── db/
│   │   │   │   ├── schema.ts # Drizzle table definitions
│   │   │   │   ├── index.ts  # DB connection singleton
│   │   │   │   └── migrate.ts
│   │   │   ├── routes/       # Hono route modules
│   │   │   │   ├── agents.ts
│   │   │   │   ├── skills.ts
│   │   │   │   ├── mcps.ts
│   │   │   │   ├── playbooks.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── jobs.ts
│   │   │   │   └── events.ts # SSE endpoint
│   │   │   ├── services/     # Business logic
│   │   │   │   ├── orchestrator.ts    # Job lifecycle management
│   │   │   │   ├── materializer.ts    # Playbook → directory generation
│   │   │   │   ├── opencode.ts        # OpenCode SDK wrapper
│   │   │   │   └── summarizer.ts      # Session summary extraction
│   │   │   └── lib/          # Utilities
│   │   │       ├── events.ts # SSE event bus
│   │   │       └── errors.ts # Error types
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   ├── web/                  # Frontend
│   │   ├── src/
│   │   │   ├── index.tsx     # Entry point
│   │   │   ├── App.tsx       # Root component + router
│   │   │   ├── api/          # API client (fetch wrapper)
│   │   │   ├── components/   # Reusable UI components
│   │   │   ├── pages/        # Route pages
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Agents.tsx
│   │   │   │   ├── Skills.tsx
│   │   │   │   ├── Projects.tsx
│   │   │   │   ├── Playbooks.tsx
│   │   │   │   ├── Jobs.tsx
│   │   │   │   └── Chat.tsx  # Multi-context chat
│   │   │   └── stores/       # Solid stores for state
│   │   ├── index.html
│   │   └── package.json
│   └── cli/                  # CLI companion
│       ├── src/
│       │   ├── index.ts      # Entry point
│       │   ├── commands/     # Command handlers
│       │   └── client.ts     # HTTP client for API
│       └── package.json
└── playbooks/                # Example playbooks (for reference/testing)
    └── qa-full/
        ├── agents/
        ├── skills/
        └── opencode.json
```

## Database Schema (Core entities)

- **agents** — id, name, description, markdown_content, tools (JSON), model, tags (JSON), source, version, created_at, updated_at
- **skills** — id, name, description, skill_md_content, has_scripts, has_templates, archive_path, tags (JSON), source, version, created_at, updated_at
- **mcps** — id, name, type (local|remote), config (JSON), enabled, health_status, created_at, updated_at
- **playbooks** — id, name, description, permission_profile, config (JSON), created_at, updated_at
- **playbook_agents** — playbook_id, agent_id (junction)
- **playbook_skills** — playbook_id, skill_id (junction)
- **playbook_mcps** — playbook_id, mcp_id (junction)
- **projects** — id, name, source_type (local|git), source_path, branch, default_model, env_vars (JSON), created_at, updated_at
- **project_playbooks** — project_id, playbook_id (junction)
- **jobs** — id, prompt, project_id, playbook_id, agent_override, model_override, status, parent_job_id, context_from, session_id, summary, cost (JSON), started_at, completed_at, created_at
- **job_events** — id, job_id, event_type, payload (JSON), created_at
- **auto_rules** — id, playbook_id, pattern, action (allow|deny), description, created_at

## Code Standards

- TypeScript strict mode everywhere
- All public functions must have JSDoc comments in English
- Use Zod schemas in `packages/shared/` as single source of truth for types — derive TypeScript types with `z.infer<>`
- API routes return consistent shape: `{ data: T }` on success, `{ error: { code: string, message: string } }` on failure
- Use Hono's built-in validators with Zod for request validation
- Frontend components are functional with Solid's `createSignal` / `createResource`
- No `any` types. Use `unknown` + type narrowing when needed
- Prefer `const` over `let`. Never use `var`
- Error handling: services throw typed errors, routes catch and format
- File naming: kebab-case for files, PascalCase for components, camelCase for functions/variables

## API Design

All routes are prefixed with `/api/v1/`. Resource routes follow REST:

```
GET    /api/v1/agents          # List (supports ?search=, ?tags=)
POST   /api/v1/agents          # Create
GET    /api/v1/agents/:id      # Get by ID
PUT    /api/v1/agents/:id      # Update
DELETE /api/v1/agents/:id      # Delete

POST   /api/v1/jobs            # Launch a job
GET    /api/v1/jobs            # List (supports ?status=, ?project_id=)
GET    /api/v1/jobs/:id        # Get job with events
POST   /api/v1/jobs/:id/respond  # Respond to permission/input request
POST   /api/v1/jobs/:id/cancel   # Cancel a running job

GET    /api/v1/events          # SSE stream (all events)
GET    /api/v1/events?job_id=  # SSE stream (filtered by job)
```

## OpenCode Integration

The `opencode.ts` service wraps @opencode-ai/sdk. For MVP:

1. **Materializer** generates a temp directory from a playbook config
2. **Orchestrator** sets `OPENCODE_CONFIG_DIR` to that directory
3. **Orchestrator** calls `opencode run` via child process (Bun.spawn) with:
   - `--model provider/model`
   - `--agent agent-name` (if specified)
   - `-f json` for structured output
4. Captures stdout/stderr, parses JSON output
5. On completion: extracts summary, stores in job record

For future phases: switch to `opencode serve` + SDK for real-time events and permission handling.

## Testing

- Use `bun test` (built-in test runner)
- Test files: `*.test.ts` next to source files
- API tests: use Hono's test client (`app.request()`)
- Minimum: test all service functions and API routes
- No frontend tests in MVP (manual testing is fine)

## Important Constraints

- SQLite database file lives at `data/agentforge.db` — this path is gitignored
- Never import from `packages/api` in `packages/web` or vice versa — use `packages/shared`
- SSE events use the format: `event: {type}\ndata: {json}\n\n`
- All timestamps are ISO 8601 strings in UTC
- Agent/skill markdown content is stored as text in the DB, materialized to files only when generating playbook directories
- The materializer creates temp dirs in `os.tmpdir()/agentforge-{jobId}/` and cleans up on completion
- Git projects are cloned to `data/workspaces/{projectId}/` with worktrees for parallel execution
