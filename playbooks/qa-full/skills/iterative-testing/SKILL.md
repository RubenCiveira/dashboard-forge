---
name: iterative-testing
description: >
  Creates unit tests iteratively, running coverage analysis after each round
  and adding tests until the target is met. Use when asked to write tests,
  improve coverage, or ensure code quality through comprehensive testing.
---

# Iterative Testing Skill

## Workflow
Execute this loop until coverage target is reached:

### Round 1: Analysis
- Read the source file(s) to understand structure
- Identify all branches, conditions, and edge cases
- Check existing tests (if any)

### Round N: Write & Verify (repeat)
- Write tests for uncovered code paths
- Run the test command with coverage enabled
- Parse coverage report
- If coverage < target: identify gaps and continue
- If coverage >= target: report summary and stop

## Coverage Commands by Framework
- **Jest**: `npx jest --coverage --coverageReporters=text`
- **Vitest**: `npx vitest run --coverage`
- **pytest**: `pytest --cov=src --cov-report=term-missing`
- **Go**: `go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out`

## Quality Standards
- Test names follow: `should {expected behavior} when {condition}`
- One assertion per test when possible
- Setup/teardown in beforeEach/afterEach, not in test body
- Mock only external dependencies (HTTP, DB, filesystem)
