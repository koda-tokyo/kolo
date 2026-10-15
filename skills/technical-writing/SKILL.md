---
name: technical-writing
description: "Technical writing operating system for KodaSōken/Kurahi/KODA KENKŌ. API documentation (OpenAPI/Swagger), architecture documentation (ADR, C4), user guides (Diátaxis), knowledge base management, bilingual (Japanese/English) documentation strategy, and docs-as-code workflows. Use when creating, reviewing, or planning any technical documentation — from API reference to user-facing guides. Triggers: documentation, API docs, architecture docs, user guide, knowledge base, bilingual docs, Japanese documentation, docs-as-code, OpenAPI, ADR, Diátaxis."
---

# Technical Writing — Documentation OS for Kurahi

## Overview

This skill provides the documentation operating system for KodaSōken, Kurahi, and KODA KENKŌ. We treat documentation as product — not an afterthought, not a chore. Everything here is practical, modern, and designed for a docs-as-code workflow (Git + Markdown + CI/CD, not Word documents in network drives).

### Our Documentation Philosophy

1. **Documentation as product.** Docs ship with the same rigor as code. They have versions, changelogs, reviews, and quality standards.
2. **Japanese-first for regulatory, bilingual for developer.** MHLW-required documentation and Japanese user-facing content is authored in Japanese. Developer docs and API references are bilingual (Japanese + English).
3. **Structure beats talent.** Diátaxis framework for user docs, ADR (with architecture-governance integration) for technical decisions, OpenAPI for API specs. Templates, not blank pages.
4. **Freshness over completeness.** Stale docs are worse than no docs. Every document knows its review date and owner.
5. **Searchability is a feature.** Information architecture, not folders of files. Docs that can't be found don't exist.

## Decision Tree — Which Documentation Do I Create?

```
QUESTION:                          → ANSWER / REFERENCE TO LOAD
────────────────────────────────────────────────────────────────
"I need API documentation"         → api-documentation.md
"How do I document architecture?"  → architecture-documentation.md
"I need a user guide or tutorial"  → user-guides.md
"How do I organize our docs?"      → knowledge-base-management.md
"How do I handle Japanese docs?"   → bilingual-documentation.md
"I need the doc quality checklist" → assets/tech-writing-toolkit.json
"What template should I use?"      → assets/tech-writing-toolkit.json
"I'm reviewing existing docs"      → assets/tech-writing-toolkit.json (quality checklist)
"I need a decision record (ADR)"   → architecture-documentation.md
"How do I version docs?"           → knowledge-base-management.md
"Can I use machine translation?"   → bilingual-documentation.md (section on MT+post-edit)
"I need an OpenAPI spec"           → api-documentation.md
```

For complex documentation tasks (e.g., a full product launch), load in this order:

1. First, decide audience and language strategy → `bilingual-documentation.md`
2. Second, determine the doc types needed → relevant reference(s)
3. Third, grab templates → `assets/tech-writing-toolkit.json`
4. Finally, quality-check against the checklist in the toolkit

## Language Strategy — Read This First

Before writing any documentation, determine the language:

| Document Type                         | Language                | Rationale                                                                   |
| ------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| **MHLW regulatory docs** (KODA KENKŌ) | **Japanese ONLY**       | Legal requirement. Machine translation prohibited for final output.         |
| **Japanese user-facing docs**         | **Japanese-first**      | Write in Japanese. English translation optional, post-edit only.            |
| **Developer docs (API/SDK)**          | **Bilingual (JA + EN)** | Both languages are first-class. Each page has a language toggle.            |
| **Internal architecture docs**        | **Bilingual**           | English primary for global team; Japanese annotations for regulatory audit. |
| **Code comments**                     | **English**             | Universal standard. Japanese comments only in MHLW-audited modules.         |
| **Changelogs / Release notes**        | **Bilingual**           | Both languages in the same document. JA first, EN follows.                  |

### 和製英語 (Wasei-Eigo) — Words We Never Use

Avoid all 和製英語 in Japanese documentation. Always use the correct Japanese term:

- マニュアル → 取扱説明書 or 手順書 (not "マニュアル")
- ドキュメント → 文書 or 資料 (not "ドキュメント" in Japanese text)
- ユーザー → 利用者 (in medical/regulatory), ユーザー is acceptable in developer docs
- データベース → データベース (acceptable — no natural Japanese equivalent)
- システム → システム (acceptable — entrenched)
- インターフェース → インタフェース (MHLW standard spelling — 3 characters, not 4)

When in doubt, consult `references/bilingual-documentation.md` for the full guide.

## How We Work

### Docs-as-Code Pipeline

```
Author writes → Git commit → PR review → CI validation → Publish
                                      ├─ Link checker
                                      ├─ Spell checker (JA + EN)
                                      ├─ Markdown lint
                                      ├─ API spec validator
                                      └─ Bilingual completeness check
```

### Document Metadata (Every File)

Every document file begins with a frontmatter block:

```yaml
---
title: "Document Title"
lang: ja # or en or bilingual
type: api-reference | architecture | user-guide | kb | adr
product: koLo | example-app | koda-soken
version: "2.1.0"
last_reviewed: 2026-05-20
review_cycle_days: 90
owner: team-name
status: draft | review | published | deprecated
---
```

### Review Cadence

| Document Type           | Review Every                       |
| ----------------------- | ---------------------------------- |
| API docs                | With every release                 |
| Architecture docs (ADR) | 90 days or on architectural change |
| User guides             | With every feature change          |
| Knowledge base articles | 180 days                           |
| Regulatory docs (MHLW)  | Per MHLW notice cycle              |

## Reference Modules

| Module                     | File                                       | When to Load                                                                           | Weight |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | ------ |
| API Documentation          | `references/api-documentation.md`          | When documenting REST APIs, SDKs, endpoints, or generating OpenAPI specs               | Heavy  |
| Architecture Documentation | `references/architecture-documentation.md` | When writing ADRs, system diagrams, READMEs, or technical specifications               | Heavy  |
| User Guides                | `references/user-guides.md`                | When creating quickstarts, tutorials, how-to guides, or troubleshooting content        | Heavy  |
| Knowledge Base Management  | `references/knowledge-base-management.md`  | When designing information architecture, versioning docs, or managing the docs backlog | Heavy  |
| Bilingual Documentation    | `references/bilingual-documentation.md`    | Before any Japanese documentation or translation workflow decision                     | Heavy  |
| Tech Writing Toolkit       | `assets/tech-writing-toolkit.json`         | Templates, checklists, and outlines — load alongside any reference                     | Light  |

## Quick Quality Checklist

Before shipping any document:

- [ ] Language strategy applied (JA/EN/bilingual per type)
- [ ] Frontmatter complete and accurate
- [ ] Links verified (no broken references)
- [ ] Code examples tested (copy-paste runnable)
- [ ] 和製英語 scan (for Japanese docs)
- [ ] SME review (subject matter expert has signed off)
- [ ] Accessibility: alt text for images, semantic headings
- [ ] Version number matches the product version it documents

## Context: KodaSōken / Kurahi / KODA KENKŌ

- **KodaSōken (幸田総研):** The parent research institute. Documentation is research-oriented: white papers, technical reports, methodology docs.
- **Kurahi:** The AI agent operating system. Documentation is developer-facing: API references, architecture decisions, integration guides, CLI docs.
- **KODA KENKŌ (幸田健康):** The healthcare product. Documentation is regulatory (MHLW) and user-facing: 取扱説明書, safety notices, patient guides, clinical evidence summaries.

When writing for any of these, apply the context-appropriate tone, language strategy, and template.
