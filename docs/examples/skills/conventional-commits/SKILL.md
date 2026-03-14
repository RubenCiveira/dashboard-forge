---
name: conventional-commits
description: >
  Ensures all commits follow the Conventional Commits specification.
  Use when finishing a task that involves writing or reviewing git history.
---

# Conventional Commits Skill

## Commit message format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

## Types
| Type | When to use |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or correcting tests |
| `docs` | Documentation only changes |
| `chore` | Build process, dependency updates, tooling |
| `perf` | Performance improvement |
| `ci` | Changes to CI/CD configuration |

## Rules
- Subject line: imperative mood, no period, max 72 characters
- Body: explain *what* and *why*, not *how*
- Breaking changes: add `BREAKING CHANGE:` in the footer
- Reference issues: `Closes #123` or `Fixes #456` in the footer

## Before committing
1. Run the test suite — do not commit failing tests
2. Run the linter — do not commit linting errors
3. Stage only the files related to this change (`git add -p` for partial staging)
