---
name: finance-fundraising
description: "Finance OS for KodaSōken — runway management, budgeting, cap table, investor relations, grant applications (Japanese and global), unit economics, and financial modeling for pre-Series A AI/healthcare startups. Covers runway calculation, burn rate, SAFE/J-KISS equity, fundraising process, term sheets, unit economics (CAC/LTV, per-hospital, inference costs), Japanese tax compliance, and NEDO/METI/MEXT grants. Triggers: runway, burn rate, cap table, equity, SAFE, J-KISS, valuation, fundraising, investor, pitch deck, term sheet, unit economics, CAC, LTV, inference cost, budget, expense approval, consumption tax, R&D tax credit, NEDO, METI, MEXT grant, dilution, KK vs GK."
---

# Finance OS — KodaSōken

Finance & fundraising knowledge base for KodaSōken (AI/healthcare, pre-Series A, Japan-based).
Practical operational finance for startups, not Wall Street theory.

## Decision Tree

When presented with a finance-related question, follow this decision tree to determine which
reference to consult and what action to take.

```
FINANCE QUESTION
├── "How long is our runway?" / "When will we run out of cash?"
│   → Read references/runway-financial-modeling.md
│   → Use runway_calculator schema from assets/finance-toolkit.json
│   → Calculate: runway = cash / net_burn. Run best/base/worst scenarios.
│   → Output: runway_months, cash_out_date, scenario table.
│
├── "What's on the cap table?" / "How much equity should X get?"
│   → Read references/cap-table-equity.md
│   → Use cap_table_template from assets/finance-toolkit.json
│   → Check: equity types (common/J-KISS/SAFE/options), dilution math, KK vs GK.
│
├── "How do we raise money?" / "What investors?" / "Term sheet?"
│   → Read references/investor-relations.md
│   → Use investor_crm_template and data_room_checklist from assets/finance-toolkit.json
│   → Pipeline management, Japanese vs international investor norms, pitch deck slides.
│
├── "What should KODA KENKŌ cost?" / "CAC/LTV?" / "GPU cost per user?"
│   → Read references/unit-economics.md
│   → Model: per-hospital ACV, per-clinician, inference cost tiers, revenue model selection.
│
├── "Build a budget" / "Expense approval?" / "Taxes?"
│   → Read references/budgeting-financial-operations.md
│   → Use budget_template from assets/finance-toolkit.json
│   → Annual budget, department P&L, tax compliance, R&D credits, angel tax.
│
├── "Are we eligible for NEDO/METI/MEXT grants?"
│   → Read references/investor-relations.md § Grant Applications
│   → Use grant_eligibility_checklist from assets/finance-toolkit.json
│   → Cross-check eligibility requirements, list required documents.
│
└── "Model a fundraising scenario" / "Build financial projections"
    → Read references/runway-financial-modeling.md + investor-relations.md
    → Combine runway calculator + scenario modeling + grant schedules.
    → Output: multi-scenario financial model with milestones.
```

## Core Principles

### Context Awareness
- Always distinguish between **KodaSōken-level** (corporate finance) and **KODA KENKŌ-level** (product unit economics).
- Ask clarifying: "Is this about KodaSōken the company, or KODA KENKŌ the product?"
- Currency defaults to JPY (¥). Convert foreign amounts to JPY at current rate if needed.

### Japanese Startup Context
- KodaSōken is a Japanese KK (株式会社), pre-Series A, AI/healthcare.
- Instruments: J-KISS is preferred for domestic investors; SAFE for international.
- Grants (NEDO, METI, MEXT) are a major non-dilutive funding source. Always evaluate grant eligibility before initiating equity fundraise.
- Japanese corporate governance expects: zeirishi (tax accountant), proper board minutes, corporate seal (hanko) for formal documents.
- Tax-qualified stock options (zeisei tekikaku) are preferred for employees. Check eligibility.

### Practical, Not Wall Street
- No DCF models, no WACC calculations, no Black-Scholes for pre-Series A.
- Use simple multiples, straightforward formulas, and clear assumptions.
- Every number should have a verifiable source or a clearly stated assumption.
- If a calculation requires data we don't have, say so and note what to collect.

## Workflows

### Runway Analysis
1. Gather: current cash balance, monthly OPEX (by category), monthly inflows.
2. Calculate gross burn, net burn, runway months.
3. Identify cash-out date (weekly granularity, factoring furikomi delays).
4. Model best/base/worst scenarios with probability-weighted grant inflows.
5. Output: one-paragraph summary + table. Flag if < 9 months runway (prepare fundraise).

### Cap Table Update
1. List all shareholders, shares, classes, vesting schedules.
2. Calculate fully diluted ownership (assume all options/convertibles exercise).
3. Model dilution from upcoming round (SAFE/J-KISS conversion at cap).
4. Check: founder vesting in place? Option pool size adequate?
5. Output: clean cap table with notes on any issues (expiring options, unvested founder shares).

### Fundraising Preparation
1. Assess: runway, milestones, team gaps. Define round size and instrument.
2. Build investor pipeline (use CRM template). Prioritize by fit, warm intro availability.
3. Prepare data room (use checklist from finance-toolkit.json).
4. Prepare pitch deck financial slides: ask slide, TAM (bottom-up), unit economics.
5. Japanese investors: allow 30% extra timeline for nemawashi. International: have English docs ready.

### Grant Application
1. Check eligibility (NEDO/METI/MEXT/other) using grant_eligibility_checklist.
2. Gather required documents (research plan, budget, CVs, support letters).
3. Note timeline — grants disburse on milestones, not upfront. Don't budget grant cash until milestone confirmed.
4. Consult zeirishi on grant tax treatment before accepting.

### Budget Build
1. Start with zero-based approach. Justify every line from scratch.
2. Personnel: named individuals only, no phantom headcount.
3. Infrastructure: separate GPU (variable) from fixed SaaS costs.
4. Tag all costs by department (R&D, Clinical, BD, G&A).
5. Grant-funded projects: separate budget with grant attribution.

## References

- **[runway-financial-modeling.md](references/runway-financial-modeling.md)** — Runway, burn rate, cash-out projection, scenario modeling, J-GAAP basics.
- **[cap-table-equity.md](references/cap-table-equity.md)** — Cap table, equity types, SAFE/J-KISS, dilution, founder vesting, KK vs GK.
- **[investor-relations.md](references/investor-relations.md)** — Fundraising process, investor pipeline, pitch deck, term sheets, JP vs intl investors, grants.
- **[unit-economics.md](references/unit-economics.md)** — CAC/LTV, KODA KENKŌ per-hospital/clinician, agent-hour costs, inference costs, revenue models.
- **[budgeting-financial-operations.md](references/budgeting-financial-operations.md)** — Budgeting, department P&L, expense approval, controls, tax compliance, incentives.

## Assets

- **[finance-toolkit.json](assets/finance-toolkit.json)** — Runway calculator schema, cap table template fields, investor CRM template, budget template sections, grant eligibility checklist, data room checklist.
