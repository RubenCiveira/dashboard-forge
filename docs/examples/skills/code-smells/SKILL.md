---
name: code-smells
description: >
  Detects common code smells: long methods, deep nesting, duplicated logic,
  and poor naming. Use this skill during any code review or refactoring task.
---

# Code Smells Detection

## What to look for

### Long methods
- Flag any function exceeding ~40 lines
- Suggest extracting into smaller, named helpers

### Deep nesting
- Flag code with more than 3 levels of indentation
- Suggest early returns (guard clauses) or extracted functions

### Duplicated logic
- Search for similar blocks repeated across files with Grep
- Suggest extracting into a shared utility

### Poor naming
- Variables named `data`, `tmp`, `x`, `foo`, `result` without context
- Boolean variables that don't read as a question (`isLoading`, `hasError`)

## Reporting
For each smell found, include:
- File path and line number
- A one-sentence description
- A concrete refactoring suggestion
