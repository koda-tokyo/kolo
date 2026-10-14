---
title: "Security Testing (QA)"
type: reference
product: all
last_reviewed: 2026-05-20
review_cycle_days: 90
owner: qa-team + security-team
status: published
---

# Security Testing — QA Perspective

## SAST: Static Analysis in CI

### Tools
- **Primary:** Semgrep (open-source rules + custom KodaSōken rules for PHI patterns)
- **Alternative:** SonarQube (enterprise features if available)

### CI Integration
Semgrep runs on every PR. Rules are tiered:

| Tier | Action on Finding | Example Rules |
|------|-------------------|---------------|
| **ERROR** | Block merge | Hardcoded secrets, SQL injection patterns, eval() usage |
| **WARNING** | PR comment, no block | Missing input validation, weak crypto, insecure random |
| **INFO** | Report only | Code style that could mask security issues |

### Custom KodaSōken Rules

```yaml
# Semgrep rule: detect potential PHI in log statements
rules:
  - id: phi-in-console-log
    pattern-either:
      - pattern: console.log(...$PHI)
    message: |
      Potential PHI in console.log. Use sanitized logger instead.
      console.log writes to browser devtools and may persist in logs.
    severity: ERROR
    paths:
      include:
        - "src/**/*.{ts,tsx}"

  - id: hardcoded-mynumber
    pattern-regex: '\b\d{4}[-]\d{4}[-]\d{4}[-]\d{4}\b'
    message: |
      Possible My Number (個人番号) found in source code.
      Never hardcode personal identifiers. Use test data generators.
    severity: ERROR
```

### Coverage
SAST covers 100% of source code in every PR. No exceptions, no exclusions without a documented and reviewed security exception.

## DAST: Dynamic Analysis

### OWASP ZAP
ZAP runs against staging environment on every deploy. Tests:
- **Passive scanning:** Analyzes traffic for vulnerabilities without modifying it
- **Active scanning:** Sends potentially malicious payloads (authenticated session, rate-limited to avoid DoSing staging)
- **API scanning:** OpenAPI spec import, ZAP tests all endpoints

### Authenticated Scanning
ZAP authenticates against staging (using a test account with appropriate permissions). DAST without authentication is nearly useless — it only finds vulnerabilities on public endpoints.

### DAST Schedule
- **Per-deploy:** Passive scan only (fast, <5 min)
- **Weekly:** Full active scan (slow, can take 30+ min)
- **Pre-release:** Full active scan + manual review of findings

## Dependency Scanning

### npm audit / yarn audit
Runs on every PR and on a daily cron for main branch.

| Severity | Action |
|----------|--------|
| **Critical** | Block merge. Must fix or provide documented exception. |
| **High** | Block merge. Fix within 24 hours. |
| **Moderate** | PR comment. Fix within current sprint. |
| **Low** | PR comment. Fix when practical. |

### Container Scanning (Trivy)
Runs on every container image build (Dockerfile change). Scans for:
- OS-level vulnerabilities (Alpine, Debian base images)
- Application dependency vulnerabilities
- Misconfigurations (running as root, exposed ports)

Critical findings block image push. High findings require a 24-hour fix window.

## OWASP Top 10 — Testing Checklist

### A1: Injection
- [ ] SQL injection tested on every parameter (use parameterized queries — verify in code review, not just with DAST)
- [ ] NoSQL injection (MongoDB `$where`, `$regex` with user input)
- [ ] Command injection (no `exec()` with user input, no `eval()`)
- [ ] Template injection (SSTI in any templating engine, including JSX interpolation of raw strings)
- [ ] Log injection (sanitize before logging — no raw user input in log messages)

### A2: Broken Authentication
- [ ] Token expiration enforced (JWT expiry checked server-side, not just client-side)
- [ ] Token refresh flow tested (refresh token rotation, reuse detection)
- [ ] Password policy enforced (minimum length 12, no complexity rules — NIST SP 800-63B)
- [ ] MFA tested (enrollment, login, recovery flows)
- [ ] Session invalidation on logout and password change

### A3: Sensitive Data Exposure
- [ ] PHI never in URL query parameters (they're logged everywhere)
- [ ] PHI never in client-side code (source maps, bundles)
- [ ] Encryption at rest verified (database encryption enabled)
- [ ] TLS 1.2+ enforced (test with outdated TLS versions — must reject)
- [ ] HTTP Strict Transport Security (HSTS) header present, max-age ≥1 year

### A4: XXE (XML External Entities)
- [ ] XML parsers configured to disable external entities
- [ ] No XML input accepted unless absolutely required (prefer JSON)

### A5: Broken Access Control
- [ ] Horizontal privilege escalation tested (user A cannot access user B's data by changing IDs)
- [ ] Vertical privilege escalation tested (regular user cannot access admin endpoints)
- [ ] Context-dependent access tested (doctor can see their patients, not all patients)
- [ ] API routes are NOT the access control mechanism (access control is declarative, not in route handlers)
- [ ] Test by manipulating: URL paths, query parameters, request bodies, JWT claims, cookies, headers

### A6: Security Misconfiguration
- [ ] `X-Content-Type-Options: nosniff` header present
- [ ] `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`
- [ ] No default credentials in any environment
- [ ] Stack traces / detailed error messages disabled in production
- [ ] CORS configuration is explicit, not `Access-Control-Allow-Origin: *`

### A7: Cross-Site Scripting (XSS)
- [ ] Content-Security-Policy header set and tested (strict CSP, no `unsafe-inline`, no `unsafe-eval` without justification)
- [ ] React's automatic escaping tested (verify dangerous patterns like `dangerouslySetInnerHTML`)
- [ ] User-generated content sanitized before rendering
- [ ] URL-based input sanitized (javascript: URLs, data: URLs)
- [ ] DOM-based XSS: test `window.location`, `document.referrer`, `postMessage` handlers

### A8: Insecure Deserialization
- [ ] No `eval()` on serialized data
- [ ] JSON.parse safe (it is, but verify no reviver functions executing code)
- [ ] No pickle/unserialize for Python services
- [ ] JWT deserialization doesn't execute code (verify library)

### A9: Using Components with Known Vulnerabilities
- Handled by dependency scanning (see above). Verify: no suppressed alerts in npm audit.

### A10: Insufficient Logging and Monitoring
- [ ] Authentication events logged (login, logout, failed attempts, password change)
- [ ] Access control failures logged (forbidden requests)
- [ ] Data modification events logged (PHI create/read/update/delete)
- [ ] Log format: timestamp, user ID, action, resource, result, source IP
- [ ] Logs are tamper-proof (append-only, write-once storage)

## API Security Testing

### Auth Token Handling
- [ ] Tokens never appear in URLs
- [ ] Tokens in Authorization header only (`Bearer` scheme)
- [ ] Refresh tokens stored securely (httpOnly cookies, not localStorage)
- [ ] Token rotation tested (old refresh token invalidated after use)

### Rate Limiting
- [ ] Rate limits tested by exceeding them (429 response)
- [ ] Rate limit headers present (`X-RateLimit-Remaining`, `Retry-After`)
- [ ] Rate limits per-endpoint, not just global
- [ ] Auth endpoints have stricter limits (brute force protection)

### Input Validation
- [ ] Every input field tested with: empty, maximum length, special characters, Unicode (including RTL override, zero-width characters), SQL metacharacters, HTML tags
- [ ] File upload: type validation, size limits, malware scan (if applicable)
- [ ] Content-Type validation: reject unexpected types

### Error Message Info Leakage
- [ ] Production errors reveal no implementation details
- [ ] 500 errors return generic message, not stack trace
- [ ] API errors return consistent structured format: `{ "error": { "code": "INVALID_PARAMETER", "message": "患者IDの形式が正しくありません" } }`

## PHI Leak Detection

### Automated Scanning
Before every deploy, grep the entire codebase and build output for PHI patterns:

```bash
# PHI patterns to detect
grep -rP '\b\d{4}-\d{4}-\d{4}-\d{4}\b' dist/          # My Number format
grep -rP '\b[1-9]\d{9}\b' dist/                         # 10-digit insurance numbers
grep -rP '\b[A-Z]-\d{7}\b' dist/                        # MRN candidate patterns
grep -rP '(email|phone|address|name|birth|patient)' --include='*.log' logs/
```

### What to Scan
- Source code (before build) — Semgrep rules
- Build output (after build) — grep scan
- Log files (staging, production samples) — grep scan
- Test data (fixtures, factories) — grep scan
- Error messages (strings in code) — code review
- Client-side JavaScript (bundles, source maps) — grep scan of build output

### Finding = Incident
A PHI pattern found in an unexpected location is a security incident, not just a bug. Report immediately per the security incident response plan. Do not fix silently.

## MHLW-Specific Security Tests (KODA KENKŌ)

### Audit Log Completeness
Test that every PHI access and modification is logged:
- [ ] Who (user ID)
- [ ] What (resource type + ID + operation)
- [ ] When (timestamp with JST timezone)
- [ ] From where (IP address)
- [ ] Result (success / denied / error)
- [ ] Why (medical purpose, per 医療情報システム安全管理ガイドライン)

### Access Control on PHI
Per MHLW guidelines (医療情報システム安全管理ガイドライン):
- [ ] Minimum necessary access (医師 only sees their patients)
- [ ] Role-based restrictions enforced and tested for every role
- [ ] Emergency access (break-glass) logged and audited
- [ ] Patient consent-based access tested (patient can revoke access to their records)

### Encryption Verification
- [ ] Data at rest: database encryption enabled, verified via query
- [ ] Data in transit: TLS 1.2+, verified via protocol test
- [ ] Backup encryption: verified on backup restore test
- [ ] Key rotation: automated, frequency documented and tested

### Audit Trail Integrity
- [ ] Logs cannot be modified after creation (append-only storage)
- [ ] Log deletion is impossible for non-admin accounts
- [ ] Log deletion by admins is logged as a log deletion event
- [ ] Audit logs retained for period required by MHLW (minimum 5 years for medical records)
