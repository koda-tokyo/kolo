# API Documentation Standards

## Overview

API documentation at KoLo/KodaSōken is treated as a first-class product deliverable. Every public API endpoint, SDK method, and integration surface must have complete, accurate, and tested documentation. We use OpenAPI 3.1+ as the single source of truth for REST APIs.

## The OpenAPI-First Workflow

```
OpenAPI spec (source of truth)
  ├─→ Auto-generated reference docs (Redoc/Scalar/Stoplight)
  ├─→ SDK code generation
  ├─→ Integration test fixtures
  ├─→ API client validation
  └─→ Changelog diff generation
```

**Rule:** The OpenAPI spec IS the API contract. If the spec doesn't describe it, the API doesn't do it. If the spec does describe it, the API must honor it. Spec and implementation stay in sync through CI validation.

## OpenAPI Specification Standards

### Minimum Required Sections

Every OpenAPI spec must include:

```yaml
openapi: "3.1.0"
info:
  title: "API Name"
  version: "2.1.0"
  description: >
    Full description in Japanese (for Japanese consumers)
    followed by English translation.
  contact:
    name: "KoLo API Team"
    email: "api@kolo.dev"
  license:
    name: "Proprietary"
servers:
  - url: "https://api.kolo.dev/v2"
    description: "Production"
  - url: "https://api-staging.kolo.dev/v2"
    description: "Staging"
tags:
  - name: "agents"
    description: "AI agent management endpoints"
paths: {}
components:
  securitySchemes: {}
  schemas: {}
```

### Versioning in OpenAPI

- **Major version** in the URL path: `/v1/`, `/v2/`
- **Minor/patch** in `info.version`
- **Deprecation** via `deprecated: true` on operations and the `Sunset` HTTP header in responses
- Never remove a field without a deprecation notice + grace period

## Endpoint Documentation Standards

### Every Endpoint Must Include

1. **Summary** (50 chars max, English): One-line description
2. **Description** (bilingual): Full explanation including business context, edge cases, and rate limits. Japanese first for KODA KENKŌ endpoints, English first for KoLo developer endpoints.
3. **Operation ID**: Unique, camelCase, semantically meaningful: `getAgentStatus`, `createHealthRecord`
4. **Tags**: At least one, for logical grouping
5. **Path parameters**: Description, type, format, validation rules
6. **Query parameters**: Same as path params + default values
7. **Request body**: Schema reference, required fields marked, content types
8. **Responses**: At minimum: 200, 201, 400, 401, 403, 404, 429, 500
9. **Examples**: Realistic, runnable examples for every response code
10. **Security**: Which security scheme applies

### Endpoint Documentation Template

```yaml
/agents/{agentId}/status:
  get:
    operationId: getAgentStatus
    summary: "Get agent runtime status"
    description: |
      # エージェント状態の取得
      指定されたエージェントIDの現在の実行状態を返します。
      状態には `running`, `idle`, `error`, `terminated` があります。

      # Get Agent Status
      Returns the current runtime status for the specified agent ID.
      States include: `running`, `idle`, `error`, `terminated`.
    tags:
      - agents
    parameters:
      - name: agentId
        in: path
        required: true
        description: "エージェントID / Agent unique identifier"
        schema:
          type: string
          format: uuid
          example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    responses:
      "200":
        description: "エージェント状態 / Agent status retrieved"
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AgentStatus"
            examples:
              running:
                summary: "実行中 / Running agent"
                value:
                  agentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                  status: "running"
                  uptimeSeconds: 3600
                  memoryUsageMB: 128
      "404":
        description: "エージェントが見つかりません / Agent not found"
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Error"
    security:
      - bearerAuth: []
```

## Request/Response Examples

### Rules for Examples

1. **Realistic data, never `"string"` or `"foo"`.** Examples must look like real production data.
2. **At least one example per non-trivial response code.** 200 and 400-series required.
3. **Bilingual summaries** on examples: `summary: "正常系 / Success case"`
4. **Truncated realistic payloads** are better than simplified fake ones. Add `...` with a comment if fields are omitted for brevity.
5. **Examples must parse.** CI pipeline validates all examples against the schema.

### Schema Documentation Standards

```yaml
components:
  schemas:
    AgentStatus:
      type: object
      required:
        - agentId
        - status
        - uptimeSeconds
      properties:
        agentId:
          type: string
          format: uuid
          description: "エージェントID / Unique agent identifier"
          example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        status:
          type: string
          enum: [running, idle, error, terminated]
          description: |
            現在の状態 / Current status:
            - `running`: 正常実行中 / executing normally
            - `idle`: 待機中 / waiting for input
            - `error`: エラー発生 / error encountered
            - `terminated`: 終了済み / process ended
        uptimeSeconds:
          type: integer
          minimum: 0
          description: "起動からの経過秒数 / Seconds since agent start"
          example: 3600
        memoryUsageMB:
          type: integer
          description: "メモリ使用量 (MB) / Memory usage in megabytes"
          example: 128
```

## Error Code Documentation

### Standard Error Response Format

All KoLo APIs use a consistent error envelope:

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "指定されたエージェントIDが見つかりません。 / The specified agent ID was not found.",
    "details": [
      {
        "field": "agentId",
        "reason": "No agent exists with this UUID in the current namespace"
      }
    ],
    "requestId": "req_abc123",
    "documentationUrl": "https://docs.kolo.dev/errors/AGENT_NOT_FOUND"
  }
}
```

### Error Code Naming Convention

`UPPER_SNAKE_CASE` with domain prefix:
- `AUTH_*` — Authentication/authorization errors
- `AGENT_*` — Agent lifecycle errors
- `GATEWAY_*` — Gateway infrastructure errors
- `VALIDATION_*` — Input validation errors
- `RATE_*` — Rate limiting errors
- `HEALTH_*` — KODA KENKŌ clinical data errors

Every error code must have a dedicated documentation page at `docs.kolo.dev/errors/{CODE}`.

## Authentication Documentation

### Documenting Auth Per Endpoint

Every endpoint explicitly states its auth requirements:

```yaml
security:
  - bearerAuth: []    # Requires JWT token
  - apiKeyAuth: []    # Alternative: API key
```

### Auth Documentation Sections Required

1. **Authentication methods** (OAuth 2.0, API keys, JWT)
2. **Token acquisition flow** with step-by-step diagrams
3. **Token refresh and expiry** behavior
4. **Scope/permission table** per endpoint
5. **Common auth error scenarios** and troubleshooting
6. **Security best practices** (key rotation, least privilege)

## SDK Documentation

### SDK Documentation Structure

```
sdk/
├── README.md           # Quick install + 5-minute quickstart
├── getting-started.md  # First API call, auth setup
├── guides/
│   ├── agents.md       # Agent management guide
│   ├── gateway.md      # Gateway operations
│   └── health.md       # KODA KENKŌ data
├── api/                # Auto-generated from OpenAPI
│   └── reference.md
├── examples/           # Runnable example scripts
│   ├── create-agent.py
│   └── health-query.py
└── migration/
    ├── v1-to-v2.md
    └── v2-to-v3.md
```

### SDK Changelog Format

```markdown
## SDK v2.1.0 (2026-05-20)

### Added
- `client.agents.getMetrics()` — Agent performance metrics endpoint
- TypeScript type exports for all response models

### Changed
- `client.agents.create()` now accepts `memoryProfile` parameter
- Minimum Node.js version bumped to 22.x

### Deprecated
- `client.agents.status()` — Use `client.agents.getStatus()` instead
- `legacyAuth` parameter — Removed in v3.0.0

### Fixed
- Race condition in token refresh during high-concurrency scenarios
```

## Deprecation Notices

### Deprecation Policy

1. **Announce deprecation** in changelog and API response headers (`Deprecation: true`, `Sunset: Sat, 01 Aug 2026 00:00:00 GMT`)
2. **Grace period:** Minimum 90 days for minor endpoints, 180 days for core endpoints
3. **Migration guide:** Published with the deprecation announcement
4. **Monitoring:** Track usage of deprecated endpoints; notify active consumers
5. **Removal:** Never remove without confirming zero traffic for 30 consecutive days

### Deprecation Documentation Template

```markdown
# Deprecation: GET /v1/agents/status
**Sunset Date:** 2026-08-01
**Replacement:** GET /v2/agents/{agentId}/status

## Migration Steps
1. Update endpoint URL from `/v1/agents/status?agentId=X` to `/v2/agents/X/status`
2. Response format changes: `state` field renamed to `status`
3. New required header: `X-KoLo-Client-Version`

## Why This Is Changing
The v1 agents endpoint grouped all agent data under flat query parameters and returned
inconsistent status codes. v2 uses resource-oriented URLs and standardized error responses.
```

## CI Validation for API Docs

Every PR touching API docs must pass:

1. **OpenAPI spec validation** (Spectral or Redocly CLI)
2. **Example validity** — all examples parse against their schema
3. **Link checker** — all `documentationUrl` fields resolve
4. **Bilingual completeness** — description fields have both JA and EN content
5. **Breaking change detection** — diff against previous spec version
