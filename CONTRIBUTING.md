# Contributing to AgentForge

Thank you for your interest in contributing. This document covers how to set up
a development environment, the conventions we follow, and the process for
submitting changes.

---

## Table of Contents

- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Code style](#code-style)

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [OpenCode](https://opencode.ai) (latest, available in `PATH`)
- Git

### Setup

```bash
git clone https://github.com/your-org/agentforge.git
cd agentforge
bun install
bun run db:migrate
bun run dev
```

The API runs on `http://localhost:4080` and the web UI on `http://localhost:3000`.

---

## Project structure

```
agentforge/
├── packages/
│   ├── api/       # Hono REST API + SSE, job orchestration, OpenCode pool
│   ├── web/       # SolidJS frontend
│   └── shared/    # Zod schemas and TypeScript types shared by api + web
├── docs/
│   ├── examples/  # Ready-to-use agents, skills, and playbooks
│   └── screenshots/
└── playbooks/     # Reference playbooks used in tests
```

Changes that affect the API contract (request/response shapes) must be made
in `packages/shared/` first, then updated in `packages/api/` and
`packages/web/`.

---

## Development workflow

```bash
bun run dev          # Start API + web in watch mode
bun run test         # Run all tests
bun run lint         # ESLint
bun run typecheck    # TypeScript check (no emit)

# Database
bun run db:generate  # Generate migrations after changing packages/api/src/db/schema.ts
bun run db:migrate   # Apply pending migrations
bun run db:studio    # Open Drizzle Studio at http://localhost:4983
```

### Changing the database schema

1. Edit `packages/api/src/db/schema.ts`
2. Run `bun run db:generate` — this creates a new migration file under `packages/api/drizzle/`
3. Run `bun run db:migrate` to apply it locally
4. Commit both the schema change and the generated migration file

---

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change with no behaviour change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Build, deps, tooling |
| `perf` | Performance improvement |

Examples:

```
feat(api): add serverPort persistence for job reconnect
fix(web): restore textarea contrast in dark theme
docs: add code-review playbook example
chore(deps): bump hono to 4.7.0
```

---

## Pull request process

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes. Keep each PR focused on a single concern.
3. Ensure all checks pass locally:
   ```bash
   bun run lint && bun run typecheck && bun run test
   ```
4. Push and open a pull request against `main`.
5. Fill in the PR template (description, test plan, screenshots if UI changes).
6. A maintainer will review and may request changes. Please respond to feedback
   within a reasonable time or the PR may be closed.

### What makes a good PR

- Small and focused — one logical change per PR
- Tests for new behaviour or bug fixes
- Updated documentation if the change affects user-facing behaviour
- No unrelated formatting or refactoring mixed in

---

## Reporting bugs

Open a [GitHub Issue](../../issues/new?template=bug_report.md) and include:

- A clear description of the unexpected behaviour
- Steps to reproduce
- Expected vs actual result
- Version of AgentForge, Bun, and OpenCode
- Relevant logs (API console output, browser console)

---

## Suggesting features

Open a [GitHub Issue](../../issues/new?template=feature_request.md) with:

- A description of the problem you are trying to solve
- Your proposed solution (optional)
- Any alternatives you have considered

---

## Code style

- **TypeScript strict mode** everywhere — no `any`, use `unknown` + narrowing
- **`const` over `let`**, never `var`
- **No default exports** from non-component files
- **Zod schemas** in `packages/shared/` are the single source of truth for
  types — derive TypeScript types with `z.infer<>`
- **API responses** always use `{ data: T }` on success and
  `{ error: { code, message } }` on failure
- **File naming**: kebab-case for files, PascalCase for components,
  camelCase for functions and variables
- **Comments**: only where the logic is non-obvious; JSDoc on all exported
  functions
