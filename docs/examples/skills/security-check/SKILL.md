---
name: security-check
description: >
  Scans code for common security vulnerabilities: injection, hardcoded secrets,
  insecure dependencies, and unsafe patterns. Use during security audits or PR reviews.
---

# Security Check Skill

## Checks to perform

### Injection risks
- SQL queries built with string concatenation instead of parameterised queries
- Shell commands built from user input (`exec`, `spawn`, `eval`)
- Template literals used directly in HTML (XSS)

### Hardcoded secrets
- Grep for patterns: `password =`, `secret =`, `api_key =`, `token =`
- Check `.env.example` is not committed with real values
- Look for Base64-encoded strings that might be credentials

### Unsafe patterns
- `eval()` or `new Function()` with external input
- Deserializing untrusted data without schema validation
- Using `Math.random()` for security-sensitive randomness (use `crypto.randomBytes`)

### Dependency issues
- Flag packages with known CVEs if a `package.json` / `requirements.txt` is present
- Suggest `bun audit` / `npm audit` / `pip-audit` for a full scan

## Reporting
Group findings by category. For each:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- File and line reference
- Explanation of the risk
- Recommended fix
