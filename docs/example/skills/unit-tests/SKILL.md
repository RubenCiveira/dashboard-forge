---
name: unit-tests
description: Creates comprehensive unit tests for a target module, iterating until >= 90% coverage. Supports bun:test, Jest, Vitest, pytest and Go test. Use when asked to write tests, add coverage or validate a module.
---

# Unit Tests Skill

## Goal

Write a complete test suite for the target module achieving ≥ 90% line and branch coverage.

## Workflow

### Round 1 — Analyze
- Read the target source file(s) with `Read`
- List all exported functions, classes and their branches/conditions
- Check for existing test files; avoid duplicating tests that already exist
- Detect the test framework in use (check `package.json`, `pyproject.toml`, `go.mod`)

### Round N — Write & Run (repeat until target met)

1. Write tests covering:
   - **Happy path**: expected inputs produce correct outputs
   - **Edge cases**: empty values, zero, null/undefined, boundary conditions
   - **Error handling**: invalid inputs, exceptions, rejected promises
   - **Each branch**: every `if/else`, `switch` case, ternary arm

2. Run with coverage:

| Framework | Command |
|-----------|---------|
| bun:test  | `bun test --coverage` |
| Jest      | `npx jest --coverage --coverageReporters=text` |
| Vitest    | `npx vitest run --coverage` |
| pytest    | `pytest --cov=src --cov-report=term-missing` |
| Go        | `go test -coverprofile=cov.out ./... && go tool cover -func=cov.out` |

3. Parse the coverage report:
   - If coverage ≥ 90%: print summary and stop
   - If coverage < 90%: identify uncovered lines/branches → go to step 1

## Test Naming Convention

```
should {expected result} when {condition}
```

Examples:
- `should return empty array when input is null`
- `should throw ValidationError when email is missing`
- `should apply discount when user has premium role`

## Quality Standards

- One logical assertion per test (multiple `expect` calls are fine when they test the same behavior)
- `beforeEach` / `afterEach` for setup and teardown; never in test body
- Mock only external dependencies: HTTP calls, database, filesystem, timers
- Do not mock the module under test or its internal helpers
- Tests must be deterministic: no random data, no `Date.now()` without mocking

## Output

- Test file: `{module-name}.test.{ext}` next to the source file
- Final coverage report pasted as a code block
- Summary: total tests written, coverage achieved, any uncoverable lines noted
