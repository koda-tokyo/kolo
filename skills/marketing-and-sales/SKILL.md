---
name: marketing-and-sales
description: >-
  Strategic marketing, sales positioning, and go-to-market messaging for KodaSōken / KODA KENKŌ
  medical AI products. Covers value proposition design, audience-specific messaging (doctors,
  administrators, investors, public), pitch architecture, competitive positioning, content
  strategy, and Japanese healthcare marketing compliance. Use when positioning products,
  writing pitch decks, designing landing page copy, preparing investor materials, crafting
  sales narratives, simplifying complex medical AI concepts for specific audiences, creating
  product one-pagers, or any marketing/sales communication task. Triggers: marketing, sales,
  pitch deck, value proposition, messaging, positioning, go-to-market, landing page, investor,
  doctor communication, product one-pager, competitive analysis, brand strategy.
---

# Marketing & Sales — CSO Strategic Communication

Two-layer architecture for positioning and selling KodaSōken medical AI products.

## Layer Architecture

**Layer 1 — Strategic Positioning (CSO domain):** Value propositions, audience architecture,
competitive maps, messaging hierarchy. This layer decides *what to say and to whom*.

**Layer 2 — Execution Engine (Writer function):** Copywriting, content production, pitch
materials, web copy, one-pagers. This layer produces *the words that say it*.

The skill handles both. When writing for Japanese healthcare audiences, always apply the
constraints in `references/japan-healthcare-marketing.md`.

## Core Workflow

For any marketing/sales task, follow this sequence:

### 1. Identify Audience

Which of the four primary audiences? Can be multiple, but message must be tailored to each.

| Audience | Core Question | Decision Driver |
|---|---|---|
| Doctors / clinicians | Will this improve patient outcomes without disrupting my workflow? | Peer evidence, clinical outcomes, integration ease |
| Hospital administrators | Will this save money, reduce liability, and satisfy MHLW? | Cost efficiency, compliance, implementation path |
| Investors / partners | What is the moat, unit economics, and growth trajectory? | Market size, differentiation, financial model |
| General public / patients | What does this do for me, in words I understand? | Clear benefit, trust signals, simplicity |

Detailed personas in `references/audience-personas.md`.

### 2. Define the Message Hierarchy

Build top-down, from shortest to longest:

1. **One-liner** (5-10 words) — The headline. What it is, for whom.
2. **Elevator pitch** (30-60 seconds spoken) — Problem, solution, why us.
3. **Executive summary** (3-5 paragraphs) — Full case with evidence hooks.
4. **Full narrative** (deck / white paper / product page) — Complete story.

Frameworks and examples in `references/messaging-frameworks.md`.

### 3. Choose the Channel

| Channel | Best For | Depth |
|---|---|---|
| Landing page hero | First impression, all audiences | One-liner + CTA |
| Product subdomain page | Product detail, doctors/admins | Elevator pitch + features |
| Pitch deck | Investors, partners | Executive summary + financials |
| One-pager / brochure | Leave-behind, all audiences | Executive summary |
| Case study / white paper | Doctors, administrators | Full narrative with evidence |
| Blog / social | Public, brand building | One-liner to elevator pitch |

### 4. Apply Positioning Framework

For each product, nail these three before writing anything:

- **Category:** What space does this occupy? (e.g., "AI-powered clinical documentation" not "healthcare software")
- **Differentiator:** What's the one thing only we do? (e.g., "Linux-based AI OS purpose-built for medical workflows")
- **Proof point:** What's the shortest path to belief? (compliance certs, clinical results, deployment count, team credentials)

### 5. Execute Copy

Apply audience language, message hierarchy, and channel format. Then apply the **simplicity filter**:

- Can a tired doctor understand this at 11pm?
- Can a stressed admin explain it to their boss?
- Can an investor repeat it after one reading?
- Would a patient's family member feel reassured?

### 6. Japanese Healthcare Check

For any material targeting Japanese medical audiences, apply `references/japan-healthcare-marketing.md`.

Non-negotiable constraints:
- No exaggerated claims (薬機法 / PMD Act compliance)
- Appropriate 敬語 level for medical professionals
- Compliance standard visibility (MHLW, ISO, PMDA)
- Evidence-first, not promise-first

## Audience-Specific Playbooks

### Doctors / Clinicians

- Lead with the clinical problem, not the technology
- Frame AI as augmentation, not replacement
- Use peer-relatable scenarios ("during a typical 10-minute consultation...")
- Mention integration with existing EMR/HIS workflows explicitly
- Japanese: 医療従事者向け — use です・ます調, cite 学会/研究会 evidence where possible

### Hospital Administrators

- Lead with operational pain (overtime, documentation backlog, audit risk)
- Quantify efficiency gains in time and yen
- Surface compliance coverage (MHLW ガイドライン, 診療報酬改定 relevance)
- Include implementation timeline and staff training requirements
- Japanese: 病院事務長/経営者向け — 丁寧語, concrete numbers, 厚生労働省 references

### Investors / Partners

- Lead with market structure, not product features
- Size the addressable market in yen and hospital beds
- Articulate the moat clearly (regulatory, technical, data network effects)
- Include unit economics and scaling path
- Japanese: 投資家向け — です・ます調 acceptable, global comparisons welcome

### General Public / Patients

- No medical jargon. None.
- Benefit-first: "Spend less time waiting" not "optimized patient throughput"
- Trust signals prominent: compliance badges, hospital adoption numbers
- Japanese: 一般向け — です・ます調, warm and clear, avoid カタカナ overuse

## The Platform Story

KODA KENKŌ should be positioned as one of two things depending on audience:

**As a layer (administrator/IT buyer):** "Works on top of your existing systems — no rip-and-replace."
**As a platform (investor/vision buyer):** "A complete AI-powered OS for healthcare, built on Linux for the AI era."

Don't say both to the same person in the same breath. Choose based on who's reading.

## Content Production Templates

- **Pitch deck outline:** `assets/pitch-deck-outline.md`
- **Product one-pager:** `assets/one-pager-template.md`
- **Messaging matrix:** `assets/messaging-matrix-template.md`

## Sales Narrative & Objection Handling

See `references/sales-narratives.md` for:
- Common objections by audience and how to answer them
- Competitive positioning frameworks
- The "AI in healthcare" trust-building arc

## Writer Persona

When execution-level copy is needed, invoke the writer persona built into this skill.
The writer operates in two modes:

- **Draft mode:** Produce first-pass copy from strategic brief. Fast, iterable.
- **Polish mode:** Refine existing copy for a specific audience. Precision over speed.

Always specify: audience, channel, length, and the one thing the reader should remember.

## References

- **audience-personas.md** — Deep persona profiles with scenarios and language preferences
- **messaging-frameworks.md** — Value proposition canvas, message hierarchy builder, positioning templates
- **japan-healthcare-marketing.md** — MHLW/PMD Act constraints, 敬語 levels, Japanese medical marketing norms
- **sales-narratives.md** — Objection handling, competitive positioning, trust arcs for healthcare AI

## Assets

- **pitch-deck-outline.md** — Investor pitch deck structure (12 slides)
- **one-pager-template.md** — Product one-pager with sections for each audience
- **messaging-matrix-template.md** — Audience × Message × Channel matrix
