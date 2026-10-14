# User Guides

## Overview

User documentation at KoLo/KODA KENKŌ follows the **Diátaxis framework** — a systematic approach that categorizes all documentation into four distinct modes. This ensures users always find the right kind of content for their current need.

## The Diátaxis Framework

```
                    STUDYING                    WORKING
                    ────────                    ───────
                    TUTORIALS                   HOW-TO GUIDES
                    (learning)                  (doing a task)
                          │                         │
                    ┌─────┴─────────┬───────────────┴─────┐
                    │               │                     │
              EXPLANATION      REFERENCE
              (understanding)  (looking up facts)
                    │               │
                    └───────┬───────┘
                        THEORIZING
```

### The Four Modes

| Mode | Purpose | User's Question | Example |
|------|---------|----------------|---------|
| **Tutorials** | Learning by doing | "How do I get started?" | "Create your first KoLo agent in 10 minutes" |
| **How-To Guides** | Solving a problem | "How do I do X?" | "How to configure MHLW audit logging" |
| **Explanation** | Understanding | "Why does it work this way?" | "How KoLo's memory system works" |
| **Reference** | Looking up facts | "What does this do?" | "Agent Runtime API reference" |

**Critical rule:** Never mix modes on the same page. A tutorial that includes explanation details loses the learner. A how-to guide with conceptual background hides the solution. Each page serves exactly one mode.

## Quickstart Guides

### Structure

```markdown
---
title: "Create Your First KoLo Agent"
lang: bilingual
type: tutorial
time_to_complete: "10 minutes"
prerequisites: ["Node.js 22+", "KoLo CLI installed", "API key"]
product: koLo
---

# 初めてのKoLoエージェント作成 / Create Your First KoLo Agent

## 目標 / Goal

このチュートリアルを完了すると、最初のKoLoエージェントが作成され、
「Hello, World」を返すようになります。

By the end of this tutorial, you'll have created your first KoLo agent
that responds with "Hello, World."

## 前提条件 / Prerequisites

- [x] Node.js 22以上 / Node.js 22 or higher
- [x] KoLo CLIインストール済み / KoLo CLI installed
- [x] APIキー取得済み / API key obtained

## Step 1: プロジェクトの初期化 / Initialize Your Project

```bash
mkdir my-first-agent
cd my-first-agent
kolo init
```

Expected output:

```
✓ Project initialized
✓ Config file created: kolo.config.yaml
✓ Ready to create your first agent
```

## Step 2: エージェント定義の作成 / Define Your Agent

Create `agent.yaml`:

```yaml
name: hello-agent
model: default
prompt: |
  You are a friendly assistant. When greeted, respond with
  "Hello, World!" and offer to help.
```

## Step 3: エージェントの起動 / Start Your Agent

```bash
kolo agent start --config agent.yaml
```

Visit http://localhost:3000 and type "Hello!"

Expected response:

```
Hello, World! How can I help you today?
```

## 次のステップ / Next Steps

- [How to add memory to your agent](memory-guide.md)
- [Deploying agents to production](deployment.md)
- [Agent API reference](api/agents.md)
```

### Quickstart Principles

1. **Timebox**: 5-15 minutes to completion
2. **Every step has visible output**: User sees progress at every step
3. **Copy-paste runnable**: Every command works as shown
4. **No explanation**: Tutorials show how, not why. Link to explanation docs.
5. **Clear finish line**: The user knows when they're done and what they achieved

## Tutorial Structure

Longer tutorials (30+ minutes) add:

### Before the Tutorial

- **Learning objectives**: "By the end, you will be able to..."
- **Prerequisites checklist**: Installable/verifiable, not just "basic knowledge of X"
- **Time estimate and difficulty**: Beginner/Intermediate/Advanced

### During the Tutorial

- **Progressive complexity**: Each step builds on the previous
- **Checkpoints**: "You should now see..." validation points
- **Error recovery**: Common mistakes and how to recover from them

### After the Tutorial

- **Cleanup**: How to tear down what was created (avoid lingering costs)
- **Next steps**: Exactly 2-3 logical follow-up activities, not a firehose of links

## Conceptual Documentation (Explanation)

### Writing Good Explanations

Explanations answer "why?" They are:
- **Historical**: Why was this decision made?
- **Comparative**: How does this approach differ from alternatives?
- **Mental-model building**: How should I think about this system?

### Anti-Patterns

- Don't bury explanation in how-to guides (forces user to read theory to do a task)
- Don't include step-by-step instructions in explanation docs (use how-to guides)
- Don't assume prior knowledge without linking to prerequisite explanations

### Explanation Template

```markdown
---
title: "KoLo Agent Memory Architecture"
lang: bilingual
type: explanation
last_reviewed: 2026-05-20
audience: developer
depth: intermediate
---

# KoLoエージェントメモリアーキテクチャ / KoLo Agent Memory Architecture

## 概要 / Overview

KoLoエージェントは3層のメモリシステムを持ちます。
各層は異なる寿命と検索特性を持ち、人間の記憶システムをモデルにしています。

KoLo agents use a three-tier memory system. Each tier has different
lifespan and retrieval characteristics, modeled after human memory systems.

## 3層構造 / The Three Tiers

### ワーキングメモリ / Working Memory
- **寿命 / Lifespan**: 単一会話 / Single conversation
- **容量 / Capacity**: ~100K tokens
- **用途 / Purpose**: 現在の文脈の保持 / Holds current context

[diagram and further explanation...]

## この設計の理由 / Why This Design?

[...historical context, alternative approaches considered...]
```

## How-To Guides

### Structure

```markdown
---
title: "How to Configure MHLW Audit Logging"
lang: bilingual
type: how-to
last_reviewed: 2026-05-20
difficulty: intermediate
time_to_complete: "20 minutes"
---

# MHLW監査ログの設定方法 / How to Configure MHLW Audit Logging

## 目的 / Goal

KODA KENKŌのMHLW監査ログ出力を設定します。
This guide configures MHLW audit logging for KODA KENKŌ.

## 前提条件 / Prerequisites
- [ ] KODA KENKŌ v2.1+ running
- [ ] Admin access to the configuration panel
- [ ] MHLW facility code (施設コード)

## 手順 / Steps

### 1. 監査ログ設定ファイルの作成 / Create the Audit Config

[step details...]

### 2. ログ出力先の指定 / Configure Output Destination

[step details...]

### 3. テスト監査イベントの送信 / Send a Test Audit Event

[step details with expected output...]

## 確認方法 / Verification

[...how to confirm it worked...]

## トラブルシューティング / Troubleshooting

### "監査ログ出力先エラー" が発生する場合
[diagnosis steps...]

### ログがMHLW形式で出力されない場合
[diagnosis steps...]
```

### How-To Principles

1. **Task-oriented title**: "How to..." not "About..."
2. **Prerequisites first**: Don't start step 1 then reveal a dependency
3. **One how-to, one task**: Don't combine "how to configure audit logging" with "how to analyze audit logs"
4. **Verifiable outcome**: User can confirm success at the end
5. **Troubleshooting section**: Common failure modes and recovery

## Reference Documentation

### API Reference Generation

API reference is auto-generated from the OpenAPI spec (see `references/api-documentation.md`). The reference docs:
- List every endpoint, parameter, response
- Are organized by tag/domain
- Include bilingual descriptions (JA/EN toggle)
- Have an interactive API console (try-it)

### Configuration Reference

```markdown
# kolo.config.yaml — Configuration Reference

## `agent.runtime`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | string | `"default"` | AI model for agent inference |
| `maxTokens` | integer | `4096` | Maximum output tokens per turn |
| `memoryProfile` | string | `"balanced"` | `minimal`, `balanced`, or `expansive` |
| `streaming` | boolean | `true` | Enable streaming responses |

## `gateway.tls`
...
```

### Reference Principles

- **Structure over prose**: Tables, lists, type signatures — not paragraphs
- **Alphabetical or logical ordering**: Consistent within each section
- **Every field documented**: Required, type, default, constraints, example
- **Cross-references**: Link to related reference sections

## Troubleshooting Guides

### Structure

```markdown
# Troubleshooting: Agent Won't Start

## Symptoms
- `kolo agent start` hangs at "Initializing..."
- Error: `EADDRINUSE` on port 3000
- Agent process exits immediately with code 1

## Diagnostic Steps

### 1. Check Port Availability
```bash
lsof -i :3000
```
**If occupied:** Kill the existing process or change port in `kolo.config.yaml`

### 2. Check Logs
```bash
kolo logs agent --tail 50
```
**Look for:** `FATAL`, `PANIC`, or connection refused errors

### 3. Verify Configuration
```bash
kolo config validate
```
**Common issues:** YAML syntax errors, missing required fields

## Solutions

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE` | Another process on port 3000 | Kill process or change port |
| Exit code 1, no error | Missing API key | Export `KOLO_API_KEY` |
| "Initializing..." hangs | Network timeout | Check firewall / VPN |
```

### Troubleshooting Design Principles

1. **Symptom-first**: Users find content by what they observe, not root cause
2. **Least-invasive first**: Check logs before changing config
3. **Clear decision points**: "If you see X, go to step 3. If you see Y, go to step 5."
4. **Recovery always leads somewhere**: Every diagnostic path ends in a fix or escalation

## Japanese vs. English User Guide Differences

### Japanese User Guides (特に医療機器 / Especially Medical Devices)

1. **Formal desu/masu form (です・ます調)** — Always. Never casual.
2. **Vertical-friendly document structure** — Consider A4 print layout; Japanese users still print documentation
3. **Explicit safety notices** — 警告 (Warning), 注意 (Caution), 禁忌 (Contraindication) clearly marked with MHLW-required iconography
4. **Government-defined terminology** — Use MHLW-designated terms, not domain translations
5. **Full-width characters and layout** — Japanese text, Japanese punctuation (、。not ,.)
6. **Regulatory numbering** — MHLW approval numbers, certification marks in header/footer
7. **Patient-first language** — 患者様 (respected patient) in KODA KENKŌ docs

### English User Guides

1. **Active voice, direct address** — "Click the button" not "The button should be clicked"
2. **US English spelling** — Default for developer docs (international standard)
3. **Accessibility-first** — Screen reader friendly, high-contrast screenshots
4. **No regulatory boilerplate in body** — Move compliance info to appendix or footer

## Document Templates

See `assets/tech-writing-toolkit.json` for:
- Tutorial template
- How-to guide template
- Explanation template
- Reference template
- Troubleshooting template
- User guide quality checklist
