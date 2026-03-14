# Changelog

All notable changes to AgentForge are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Job persistence across API restarts: `serverPort` column on jobs, reconnect to
  live OpenCode servers, resume with conversation history when server is dead
- `<<TASK_DONE>>` marker injection for reliable task-completion detection in
  conversational (human-in-the-loop) sessions
- "Mark as done" manual fallback button in the job detail panel
- Auto-scroll to latest message in the conversation view
- OpenCode session SQLite reader (`getOpenCodeSession`) for full conversation history

### Fixed
- Dark theme textarea contrast — text was invisible when typing a response
- Premature job completion after first agent question in multi-turn sessions
- Concurrency slot leak when a job was cancelled via the HTTP API

---

## [0.1.0] - 2026-03-14

### Added
- Initial release
- Playbook-based agent composition (agents + skills + permission profiles)
- Kanban board for job lifecycle management (`Pending → Running → Waiting Input → Completed`)
- Human-in-the-loop: permission approval and plain-text question answering
- OpenCode server pool with idle TTL reaper
- Job dispatcher with configurable `maxConcurrent` setting
- SSE event stream for real-time job updates
- Projects: local directory and Git repository support
- Skills library and agent library with Markdown-based definitions
- Runner configuration UI
- SQLite database via Drizzle ORM
- SolidJS frontend with TailwindCSS v4
