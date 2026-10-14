# HTML Artifacts — The New Collaboration Medium

> *"HTML is the new Markdown."* — Thorick, Claude Code team (Anthropic)

## Why HTML Over Markdown

Markdown is linear. HTML is spatial. When agents run for 8 hours and specs hit 1,000+ lines, humans stop reading. HTML solves this: scrollable, visual, with mockups, code excerpts, and interactive elements. Rich enough to engage you, cheap enough to throw away.

**Key insight from Anthropic's Claude Code team:** "1% of tokens go to production code. 99% go to beautiful scaffolding — dashboards, custom interfaces, specs — that get me in sync with Claude."

## Three Core Patterns

### Pattern 1: Interactive HTML Project Plans

**When:** Starting a new feature, brainstorming, implementation planning.

**The prompt template:**
> "Create an HTML file as a plan that helps me visualize the implementation. Include excerpts, mockups, code, whatever is needed to give me maximum context."

**What it produces:** A single HTML file with visual mockups, code snippets, file structure overview, mood board, insights, and templates. Scrollable, shareable, actually readable.

**Why it works:**
- You can SEE the plan, not just read it
- Mockups convey intent that words can't
- Code excerpts show the API surface, not just theory
- Easier to share with non-technical stakeholders
- More likely to actually read and engage with

**The trust pattern:** "Whatever is needed to give me maximum context" = trust the model. Don't over-constrain. Give it an escape hatch.

### Pattern 2: Disposable Micro-Apps for Editing

**When:** A section of your plan has complex structured data (decision tables, config rules, routing logic) that's painful to edit as text.

**The prompt template:**
> "Create an editable HTML artifact to help me define the [decision rules/configuration/table]. Make this a custom UI that helps me with structure but gives me flexibility. Design the ideal interface for this problem."

**What it produces:** A throwaway single-page custom UI — forms, inputs, buttons, copy-to-clipboard — purpose-built for that one editing task. Use it once, extract the refined output, discard it.

**Why it works:**
- Complex structured data → custom editor, not markdown fiddling
- "Micro-software on top of micro-software" — personalized plan → custom editor for one module
- Gamified, consumer-y feel → actually engage with the content
- Copy-to-clipboard integration → refined output flows back into the plan

**Key design elements to request:**
- Input fields for each configurable value
- Add/remove/hide controls
- Copy-to-clipboard button (exports structured output)
- Visual feedback on changes

### Pattern 3: Living HTML Design System

**When:** Need UI consistency across projects. Want AI to stay on-brand automatically.

**The prompt template:**
> "Analyze my codebase and generate a design_system.html showing our color palette, typography, spacing rules, and interactive component examples."

**What it produces:** A single `design_system.html` containing:
- Color palette (with hex values, usage context)
- Typography scale (font, size, weight, line-height for each level)
- Spacing tokens (base unit, all multiples)
- Border radius scale
- Core components with interactive previews
- Component variations (sliders/knobs to explore padding, color, sizing)

**The workflow:**
1. Point Claude at your repo → extract design DNA
2. Generate `design_system.html`
3. Drop it in the repo root
4. Every new feature prompt includes: "Reference design_system.html for styling"
5. AI stays on-brand automatically

**Advanced: Component visualization page**
- 25+ components rendered interactively
- Transparent PNG download per component
- Non-technical stakeholders (marketing, product) can self-serve mockups
- Use as source of truth for videos, decks, documentation

## Collaboration Patterns

### Sharing
- Upload HTML file to any static host (S3, Vercel, Netlify)
- Share URL with team — 100x more likely they'll read it vs markdown
- No special tools needed — any browser

### Comments and Annotations
- Ask Claude to build comment functionality into the HTML plan
- "Add a commenting system to this plan so reviewers can leave feedback"
- Comments get exported back into the development workflow

### Weekly Status Updates
> "Read my Slack from this week, create an HTML status update showing everything I shipped."

- More engaging than text summaries
- Actually gets read by managers
- "The amount of tokens I produce that go into production code: 1%. But I'm generating so many more tokens for dashboards, custom interfaces, really trying to get a sense of what I want to do."

## When NOT to Use HTML

- Quick one-line questions to Claude (just talk)
- Simple code changes with no planning needed
- When collaborating in a system that requires markdown (GitHub PRs)
- API documentation that needs to be version-controlled as text

## The Compute Allocator Mindset

> *"When you say 'Claude can run for 8 hours,' what you're really saying is 'Claude can spend $500.' All of us are becoming compute allocators now."*

The spec phase IS the decision. If you're spending $500 on compute, you better be in the loop on what it's building. HTML makes that possible — it pulls you in, engages you, makes you actually review the plan instead of saying "eh, probably fine."

**The formula:** Types (data model as interface boundary) + Verification criteria (tests/rubrics) = the two bookends. Everything in the middle is the agent's job. But those bookends? That's your job. The compute allocator's job.

---

## Quick Reference: Prompt Templates

| Task | Prompt |
|------|--------|
| Brainstorm ideas | "Brainstorm some ideas in an HTML file" |
| Full implementation plan | "Create an HTML file as a plan. Include excerpts, mockups, code, whatever is needed to give me maximum context" |
| Custom editor | "Create an editable HTML artifact to help me define [X]. Make this a custom UI with structure and flexibility. Design the ideal interface" |
| Design system | "Analyze my codebase and generate a design_system.html with colors, typography, spacing, components" |
| Status update | "Read my Slack from this week. Create an HTML status update of everything I shipped" |

---

*Source: Thorick (Claude Code, Anthropic) × Claire Vo (ChatPRD) — "HTML is the new Markdown," Code with Claude 2026*
