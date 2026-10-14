# Product Strategy

## Product Vision vs Company Vision

**Company vision** = where the organization is going (e.g., "become the trusted AI
layer for Japanese primary care").

**Product vision** = what the product becomes to serve that (e.g., "KODA KENKŌ is the
AI clinical co-pilot that every Japanese primary care physician uses during a
consultation").

The product vision must ladder up to company vision but be concrete enough that a
sprint team can make daily decisions against it.

**Litmus test:** Can every team member answer "does this feature move us toward the
product vision?" If not, the vision isn't clear enough.

## Product-Market Fit Signals

In Japanese healthcare, PMF doesn't look like Western SaaS PMF. Our signals:

| Signal | Weak PMF | Strong PMF |
|--------|----------|------------|
| **Usage** | Pilot users log in once | Daily active use during real consultations |
| **Retention** | Churn after pilot ends | Hospitals renew without prompting |
| **Referral** | "Interesting idea" | KOLs introduce us to other KOLs unprompted |
| **Willingness to pay** | "Maybe if insurance covers it" | Hospital budgets for it in annual planning |
| **Workflow integration** | Used separately from EMR | Staff complain when it's unavailable |
| **Clinical trust** | Physicians double-check everything | Physicians act on recommendations |

**The only PMF signal that matters in Japanese healthcare:** a hospital that has
finished a pilot, paid for a renewal, AND had a physician tell a peer at another
hospital to buy it. All three. That's our "retention + referral + revenue" trifecta.

## Strategy Frameworks

### Playing to Win (Lafley & Martin)

Five cascading choices. For each, ask:

1. **Winning aspiration** — What does winning look like for KODA KENKŌ?
   _Example: "Be the AI co-pilot in 500+ Japanese primary care clinics by 2028"_

2. **Where to play** — Which segments? Which geographies? Which clinical workflows?
   _Example: "Primary care clinics in Tokyo/Osaka metro, starting with consultation support, expanding to chronic disease management"_

3. **How to win** — What's our unique advantage?
   _Example: "Japanese-native NLP + KOL co-design + PMDA-first regulatory strategy"_

4. **Core capabilities** — What must we be excellent at?
   _Example: "Clinical NLP accuracy, physician UX, regulatory navigation"_

5. **Management systems** — What processes sustain this?
   _Example: "Continuous KOL feedback loops, PMDA pre-consultation cadence"_

### Good Strategy / Bad Strategy (Rumelt)

**Bad strategy** = fluff + a list of goals without actions + denial of constraints.

**Good strategy** = diagnosis (what's the real challenge?) + guiding policy (how do we
approach it?) + coherent actions (what specific things do we do?).

Apply Rumelt's kernel to every major product decision:

- **Diagnosis:** "Japanese physicians spend 40% of consultation time on documentation,
  not clinical reasoning. Existing EMR tools are data-entry systems, not intelligence."
- **Guiding policy:** "Don't compete with EMR vendors. Integrate at the workflow level
  and augment clinical reasoning, not documentation."
- **Coherent actions:** "1) Build clinical NLP engine on Japanese medical corpus,
  2) Design UI that works during a 6-minute consultation, 3) Secure PMDA SaMD
  classification guidance before building regulated features."

## Make vs Buy vs Partner

For each product capability, decide:

| Factor | Build | Buy | Partner |
|--------|-------|-----|---------|
| **Core to differentiation?** | Yes → Build | No → Buy/Partner | Maybe |
| **Available off the shelf?** | No → Build | Yes → Buy | Partial → Partner |
| **Speed needed?** | 6+ months → Build | Weeks → Buy | Months → Partner |
| **Japanese domain fit?** | Must customize → Build | Generic → Buy | Can localize → Partner |
| **Regulatory burden?** | We bear it → Build | Vendor bears it → Buy | Shared burden |
| **Strategic moat?** | Yes → Build | No → Buy | Some → Partner |

**Default for KodaSōken:** Build anything that touches clinical reasoning or
Japanese NLP. Buy infrastructure (cloud, auth, monitoring). Partner for data
acquisition and distribution channels.

### Specific Make/Buy recommendations for KODA KENKŌ:
- **Clinical NLP models** → BUILD (core moat, no Japanese medical LLM off the shelf)
- **EMR integration layer** → PARTNER (EMR vendors control APIs, partner for access)
- **Speech-to-text (Japanese medical)** → BUILD or PARTNER (Amivoice/Google are decent but not medical-grade)
- **Cloud infra** → BUY (AWS/GCP, don't build servers)
- **Auth / SSO** → BUY (Cognito/Auth0, hospitals all have their own requirements)
- **Analytics / dashboards** → BUY early, BUILD custom later if differentiation emerges

## Platform vs Point Solution

**Point solution:** Does one job exceptionally well. Easier to sell, easier to build,
clearer value prop. Japanese hospitals buy these.

**Platform:** Does many jobs, creates an ecosystem. Harder to sell initially, bigger
moat once established, higher ceiling.

**KodaSōken's path:** Point solution → multi-product → platform.

1. **Phase 1 (now):** KODA KENKŌ is a point solution — "AI consultation support for
   primary care." Nail this before expanding.
2. **Phase 2 (horizon):** Add adjacent point solutions (chronic disease, patient-facing
   summaries, pharmacy integration).
3. **Phase 3 (future):** When 2+ point solutions share data/identity/infrastructure,
   you have a platform. Don't call it one before it is one.

**The trap:** Calling yourself a platform too early. Japanese hospital procurement
doesn't buy "platforms" from startups. They buy specific solutions to specific
problems. Resist the urge to platform prematurely.

## Regulatory Gates (Japanese Healthcare)

Product strategy in Japanese healthcare runs on a regulatory clock:

- **非医療機器 (non-medical device):** General wellness, decision support without
  diagnostic claims. Faster path, lower barrier. Most early KODA KENKŌ features.
- **医療機器 (medical device, Class I–IV):** Regulated by PMDA. Class II+ requires
  clinical evidence. Timeline: 12–24 months from submission.
- **SaMD (Software as Medical Device):** Specific PMDA program. KODA KENKŌ features
  that provide diagnostic suggestions may trigger this classification.

**Strategy implication:** Know which regulatory class each feature falls into before
committing to a roadmap timeline. A "simple feature" that triggers SaMD classification
goes from a 2-week build to a 12-month regulatory process.

Always ask: "Does this feature make a diagnostic claim?" If yes → regulatory review
required before roadmap commitment.
