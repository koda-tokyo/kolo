---
name: react-web
description: "Build React web applications with the 2026 consensus stack: React 19, Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui, TypeScript. Covers Server Components, data fetching, auth (Auth.js v5), AI integration (Vercel AI SDK), monorepo patterns, and HTML artifact workflows. Use when creating or modifying React web apps, SPAs, dashboards, marketing sites, or any frontend web project. Triggers: React, Next.js, Tailwind, shadcn UI, shadcn, web app, frontend, component, Server Component, App Router, build a website, create a UI."
---

# React Web — 2026 Frontend Stack

Build production React applications with the current consensus stack: React 19, Next.js 15 App Router, Tailwind CSS v4, shadcn/ui, TypeScript.

## Quick Start

Generate a new project with the 2026 stack:
```bash
npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd my-app && npx shadcn@latest init -d
```

## Project Conventions

- **Server Components by default.** Client components only at leaves (`'use client'`).
- **App Router** with `src/` directory. Colocate page-specific components.
- **TypeScript strict mode.** Types are documentation that compiles.
- **Tailwind v4** CSS-native configuration. `@theme` for design tokens.
- **shadcn/ui** for components. Copy source, own it. Not an npm dependency.

## Reference Modules

| Module | File | When to load |
|--------|------|-------------|
| Next.js patterns | [references/nextjs-patterns.md](references/nextjs-patterns.md) | Project structure, routing, layouts, middleware |
| Tailwind v4 | [references/tailwind-v4.md](references/tailwind-v4.md) | Styling, theming, responsive design |
| shadcn/ui patterns | [references/shadcn-patterns.md](references/shadcn-patterns.md) | Component composition, forms, dialogs |
| Server Components | [references/server-components.md](references/server-components.md) | RSC vs Client, streaming, Suspense |
| Data fetching | [references/data-fetching.md](references/data-fetching.md) | Server Actions, TanStack Query, caching |
| Auth patterns | [references/auth-patterns.md](references/auth-patterns.md) | Auth.js v5, middleware, roles |
| AI integration | [references/ai-integration.md](references/ai-integration.md) | Vercel AI SDK, streaming, tool calling |
| HTML artifacts | [references/html-artifacts.md](references/html-artifacts.md) | HTML plans, micro-apps, living design systems |

## Context7 Integration

For live, non-hallucinated API docs, use `context7` to resolve and fetch documentation:
```bash
python3 {baseDir}/../context7/scripts/context7.py resolve "react"
python3 {baseDir}/../context7/scripts/context7.py docs /vercel/next.js --topic "app router"
```

## Key Architecture Decisions

1. **Server Components first.** Fetch data in RSC. Pass to client components as props.
2. **Server Actions for mutations.** No API routes for form submissions. Progressive enhancement built in.
3. **TanStack Query for client-side data.** Caching, refetching, optimistic updates.
4. **shadcn/ui copied, not installed.** Full control over component source. Customize freely.
5. **TypeScript everywhere.** `strict: true`. Zod for runtime validation.
6. **Tailwind v4 CSS-native.** No `tailwind.config.js`. Design tokens in CSS via `@theme`.

## HTML Artifacts Pattern

When planning features, generate HTML plans instead of markdown. Include mockups, code excerpts, visual layout. See [references/html-artifacts.md](references/html-artifacts.md) for the full workflow from Thorick's Anthropic talk.

## Scripts

- `scripts/init-project.py` — Scaffold Next.js + Tailwind + shadcn project (planned)
- `scripts/add-component.py` — Add shadcn component with conventions (planned)
