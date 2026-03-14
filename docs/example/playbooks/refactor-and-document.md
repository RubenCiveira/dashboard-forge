---
name: refactor-and-document
description: Refactors code for quality, generates DocBook documentation for the module and its API, then writes a full unit test suite. Use on any module or service that needs cleanup and proper coverage.
permission_profile: autonomous
agents: refactor-engineer
skills: docbook-module, docbook-api, unit-tests
---

## Execution Order

Run the following phases in sequence:

1. **Refactor** — apply the `refactor-engineer` agent to clean up the target code
2. **Document module** — use `docbook-module` skill to generate `docs/{module}-reference.xml`
3. **Document API** — use `docbook-api` skill to generate `docs/api-reference.xml` (skip if no HTTP routes found)
4. **Tests** — use `unit-tests` skill to write tests and reach ≥ 90% coverage

## Constraints

- Complete each phase before starting the next
- If refactoring changes public signatures, update documentation accordingly
- All generated files go under `docs/` (create the directory if missing)
- Report a one-line summary per phase on completion
