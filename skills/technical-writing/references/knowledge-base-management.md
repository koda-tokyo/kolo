# Knowledge Base Management

## Overview

The KoLo knowledge base is the living repository of all product documentation. It is not a static archive — it has information architecture, search optimization, freshness controls, and a maintenance cadence. This reference covers how to design, build, and sustain a docs knowledge base that works as hard as the product it documents.

## Information Architecture for Documentation

### The IA Principle

Documentation must be findable without knowing what it's called. Users arrive with a *need*, not a file path.

### Site Structure (Docs-as-Code, Docusaurus/Astro/Next.js)

```
docs.kolo.dev/
├── getting-started/           # Tutorials + Quickstarts
│   ├── index.md               # "Welcome to KoLo" — first-time landing
│   ├── quickstart.md          # 5-minute first API call
│   └── first-agent.md         # Create your first agent
├── guides/                    # How-To Guides
│   ├── agents/
│   ├── gateway/
│   ├── memory/
│   ├── deployment/
│   └── mhlw-compliance/       # KODA KENKŌ specific
├── explanation/               # Conceptual / Deep Dives
│   ├── architecture/
│   ├── agent-runtime.md
│   ├── memory-system.md
│   └── security-model.md
├── reference/                 # API + Config + CLI Reference
│   ├── api/                   # Auto-generated from OpenAPI
│   ├── cli.md
│   ├── config.md
│   └── error-codes.md
├── architecture/              # ADRs (link to architecture-governance)
│   ├── adr/
│   └── diagrams/
├── releases/                  # Changelogs, migration guides
└── contribute/                # Contributor docs
    ├── style-guide.md
    ├── template-guide.md
    └── review-process.md
```

### URL Design

- **Stable, logical, hierarchical**: `/guides/agents/create-agent/` not `/page?id=123`
- **No version in URL for latest**: `/reference/api/` always points to latest stable
- **Versioned docs at**: `/v2/reference/api/` for older versions
- **Redirects for moved content**: Never break a URL without a 301 redirect
- **Language toggle**: `/reference/api/` ↔ `/ja/reference/api/` (path-prefix pattern)

### Navigation Principles

1. **Information scent**: Link text must predict the destination content
2. **Three-click rule**: Any document reachable within 3 clicks from the homepage
3. **Multiple entry paths**: Same document accessible via search, category, related-links, and in-page TOC
4. **No dead ends**: Every page links to at least one logical next step
5. **Breadcrumbs on every page**: `Home > Guides > Agents > Create an Agent`

## Search Optimization

### In-Docs Search (Algolia / Typesense / Orama)

1. **Custom ranking by doc type**: API reference > Guides > Architecture > Changelog
2. **Section-level indexing**: Users search for "configure MHLW" → get the exact section, not the whole page
3. **Bilingual search**: Queries in Japanese match Japanese content; English queries match English content. Cross-language fallback if no results.
4. **Synonyms**: "エージェント作成" ↔ "create agent", "セットアップ" ↔ "setup"
5. **Zero-result pages**: When a search returns nothing, suggest alternative terms or ask user to open a docs issue

### SEO for Public Docs

- **Title tags**: `{Page Title} | KoLo Docs` or `{ページタイトル} | KoLo ドキュメント`
- **Meta descriptions**: Bilingual, 155-160 characters
- **Canonical URLs**: `/reference/api/` canonical, `/ja/reference/api/` has `hreflang="ja"`
- **Structured data**: `TechArticle` or `APIReference` schema.org types on relevant pages
- **Sitemap**: Auto-generated, bilingual entries with `hreflang` alternates

## Content Freshness

### Freshness Indicators

Every document page displays:
- **Last reviewed date** (from frontmatter `last_reviewed`)
- **Product version** it documents (from `version`)
- **Review status badge**: Up-to-date (green) / Needs review (yellow, > review cycle) / Stale (red)

### Staleness Detection (Automated)

```yaml
# CI pipeline: docs-freshness-check.yml
name: Documentation Freshness Check
on:
  schedule:
    - cron: '0 8 * * 1'  # Every Monday 08:00 JST

jobs:
  check-freshness:
    steps:
      - name: Scan frontmatter for stale docs
        run: |
          for file in docs/**/*.md; do
            last_reviewed=$(yq -r '.last_reviewed' "$file")
            review_days=$(yq -r '.review_cycle_days' "$file")
            days_since=$(( ($(date +%s) - $(date -d "$last_reviewed" +%s)) / 86400 ))
            if [ "$days_since" -gt "$review_days" ]; then
              echo "STALE: $file (last reviewed $days_since days ago, cycle: $review_days)"
            fi
          done
      - name: Create freshness issues
        run: |
          # Auto-create GitHub issues for stale docs
```

### Review Triggers

Documentation is flagged for review when:
1. **Calendar-based**: Review cycle days exceeded (API: 90d, Architecture: 90d, Guides: from feature change)
2. **Product change**: New release touches documented behavior
3. **User feedback**: Negative feedback or confusion reports (see Feedback Loops)
4. **Deprecation**: Related endpoints/features deprecated

### Deprecation in KB

- Deprecated docs get a prominent banner: "この機能は非推奨です / This feature is deprecated"
- Banner links to migration guide or replacement
- Deprecated docs remain accessible for at least 180 days after deprecation
- Archive category for removed features (not deleted, moved to `archive/`)

## Versioning Documentation

### Version Strategy

```
Product Version    Docs Version    Behavior
────────────────────────────────────────────
v2.3 (latest)      /docs/          Latest stable docs, always at root
v2.2 (stable)      /v2.2/          Frozen docs for v2.2
v2.1 (EOL)         /v2.1/          Frozen + deprecated banner
v1.x (archived)    /archive/v1/    Read-only, no maintenance
v3.0 (beta)        /next/          Pre-release docs, "Beta" banner
```

### Version Selector

Every docs page has a version dropdown:
```
[ v2.3 (latest) ▾ ]
  v2.2 (stable)
  v2.1 (deprecated)
  v3.0 (beta) → /next/
```

### Version-Specific Content

- When an API parameter or behavior changes between versions, use version badges in the reference docs
- Migration guides for every major version change
- "Added in v2.2" / "v2.2で追加" badges on new features

## Feedback Loops

### Docs Analytics

Track per page:
- **Page views and unique visitors**
- **Time on page** (low time + high bounce = didn't find what they needed)
- **Search queries** that led to the page
- **Search queries with zero results** (docs gaps)
- **"Was this helpful?"** thumbs up/down ratio
- **Copy-button clicks** on code examples (indicates active use)

### User Feedback Mechanisms

1. **"Was this helpful?"** widget at the bottom of every page
2. **"Edit this page"** link (GitHub PR flow for docs)
3. **Feedback form** for detailed input: "このページに何か問題がありましたか？"
4. **Community channels** monitored for recurring documentation questions

### Feedback → Action Pipeline

```
User reports confusion
      │
      ▼
Weekly docs triage (automated issue from feedback)
      │
      ├─ Quick fix (< 1 hour) → same-day PR
      ├─ Structural issue → add to docs backlog
      └─ Feature request → route to product team
```

## Maintenance Cadence

### Weekly

- Review docs analytics report
- Triage user feedback
- Merge docs PRs
- Check for broken links (automated CI)

### Monthly

- Freshness report review: flag docs approaching review deadline
- Search quality review: top zero-result queries
- Contributor recognition (top docs contributors)

### Quarterly

- Full documentation audit
- Update versioned docs for new product version
- ADR index review: mark superseded, archive old
- Accessibility audit (screen reader, contrast, keyboard nav)

### Annually

- Information architecture review: does structure still match product?
- Major version archiving: move EOL versions to archive
- Documentation strategy retrospective

## Contributor Guides

### Quickstart for New Docs Contributors

```markdown
# Contributing to KoLo Docs

## First Time Setup
1. Clone the docs repo
2. Run `make setup` (installs linters, preview server)
3. Read the style guide (5 minutes)

## How to Contribute
1. Find or create an issue
2. Create a branch: `docs/fix-agent-start-guide`
3. Write your changes following the template for that doc type
4. Run `make check` to validate
5. Open a PR
6. Docs team reviews within 2 business days

## Templates
- [Tutorial template](templates/tutorial.md)
- [How-to template](templates/how-to.md)
- [API doc template](templates/api-endpoint.md)

## Style Guide
- [Writing style](style-guide.md)
- [Japanese conventions](ja-style-guide.md)
```

### Documentation Ownership

Every section of the docs has an owner:

| Section | Owner Team | SLA for Updates |
|---------|-----------|-----------------|
| API Reference | Platform Engineering | Same-day for API changes |
| Agent Guides | Agent Runtime Team | Within sprint |
| MHLW Compliance | Reg. Affairs + Systems | Per MHLW notice cycle |
| Architecture ADRs | CTO Office | Within 2 weeks of decision |
| Tutorials | Developer Relations | Per release |

## Tooling

- **Static site**: Docusaurus 3+ (or Astro Starlight for API-heavy sites)
- **Search**: Algolia DocSearch or self-hosted Typesense
- **Analytics**: Plausible (privacy-first) or PostHog
- **Link checker**: `lychee` in CI pipeline
- **Spell checker**: `cspell` with JA + EN dictionaries
- **Linter**: `markdownlint` with custom rules
- **Diagrams**: Mermaid (embedded) + Structurizr (C4)
- **API docs**: Redoc or Scalar (generated from OpenAPI spec)
- **Versioning**: Docusaurus versioning plugin or custom `cp -r` + redirects
